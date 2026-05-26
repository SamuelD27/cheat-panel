# Civilization VII Cheat Panel Mod — Technical Reference

> Status: reference doc, not a tutorial. Last verified against Civ VII patch 1.4 ("Test of Time", May 2026). Windows / Shadow PC target. Audience: developer comfortable with JS/TS who has not yet touched Civ modding.

---

## 1. Civilization VII Modding Fundamentals

### 1.1 Official tooling and timeline
- **Modding SDK + Steam Workshop support** shipped with **Update 1.2.2 on June 23, 2025**. The SDK is delivered through Steam's Tools library. Per the Firaxis Update Check-In (2k.com/civ-vii/news/civ-vii-update-check-in-jun-10, June 10 2025): "While this initial version of the SDK won't feature art tools, it will include a mod uploader and the (glorious) return of FireTuner." Same FireTuner used in Civ V/VI, now talking to V8 instead of Lua.
- **Steam Workshop** is the official distribution channel; community sources are **CivFanatics Forums** (forums.civfanatics.com) and **Nexus Mods** (nexusmods.com/civilizationvii).
- There is **no ModBuddy for Civ 7**. The build pipeline is "write XML/SQL/JS files in a folder structure, drop folder into the Mods directory."
- 2K/Firaxis FAQ notes that mods that "have the capability to impact fair play or modify game memory files may result in a poor game experience, technical issues, or inability to log into Civilization VII" (support.civilization.com Third-Party Mods FAQ) — cheat mods are tolerated for single-player but out of scope for online-progression play.

### 1.2 Mods directory (Windows)
```
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Mods\
```
Each mod is a folder, entry point a `.modinfo` file (XML). The game scans this directory at launch; there is no in-game "Reload Mods" — **changes require restarting the game** for `.modinfo` re-parse and DB re-binding. UIScript-only edits sometimes pick up via the in-game console's `reload` button.

Game install (Steam default):
```
C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\
```
The **unpacked base game files** live at:
```
…\Sid Meier's Civilization VII\Base\modules\           ← gameplay XML/SQL + UI JS
…\Sid Meier's Civilization VII\Base\Platforms\Windows\Config\TunerPanels\
```
DLCs are at `…\Civilization VII\DLC\<dlc-name>\` and structured identically to user mods. **Read these for reference whenever you need an API call** — there is no published API reference, only the shipped code.

Logs:
```
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Logs\
  UI.log         ← console.log / console.error from JS UI
  Database.log   ← XML/SQL load errors
  Modding.log    ← modinfo load errors and skipped items
```

### 1.3 .modinfo file structure
Skeleton:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Mod id="local-cheat-panel" version="1" xmlns="ModInfo">
  <Properties>
    <Name>Local Cheat Panel</Name>
    <Description>Solo-play cheat/sandbox panel</Description>
    <Authors>you</Authors>
    <AffectsSavedGames>0</AffectsSavedGames>
    <EnabledByDefault>1</EnabledByDefault>
  </Properties>
  <Dependencies /><References />
  <ActionCriteria>
    <Criteria id="always"><AlwaysMet/></Criteria>
    <Criteria id="any-age" any="true">
      <AgeInUse>AGE_ANTIQUITY</AgeInUse>
      <AgeInUse>AGE_EXPLORATION</AgeInUse>
      <AgeInUse>AGE_MODERN</AgeInUse>
    </Criteria>
  </ActionCriteria>
  <ActionGroups>
    <ActionGroup id="cheat-panel-game" scope="game" criteria="any-age">
      <Properties><LoadOrder>100</LoadOrder></Properties>
      <Actions>
        <UIScripts>
          <Item>ui/cheat-panel/cheat-panel.js</Item>
          <Item>ui/cheat-panel/panel-units.js</Item>
          <Item>ui/cheat-panel/panel-cities.js</Item>
          <Item>ui/cheat-panel/panel-map.js</Item>
        </UIScripts>
        <ImportFiles>
          <Item>ui/cheat-panel/cheat-panel.html</Item>
          <Item>ui/cheat-panel/cheat-panel.css</Item>
        </ImportFiles>
        <UpdateDatabase>
          <Item>data/input-bindings.xml</Item>
        </UpdateDatabase>
      </Actions>
    </ActionGroup>
    <ActionGroup id="cheat-panel-shell" scope="shell" criteria="always">
      <Actions><UIScripts><Item>ui/cheat-panel/shell-options.js</Item></UIScripts></Actions>
    </ActionGroup>
  </ActionGroups>
</Mod>
```

Key points:
- **`scope="game"`** = active during a match; **`scope="shell"`** = main menu / setup screens.
- **`<UIScripts>`** vs **`<ImportFiles>`**: `<UIScripts>` are JS files the UI module loader executes on register. `<ImportFiles>` is for HTML/CSS/icons/textures referenced by those scripts and for JS files you want available but not auto-loaded. Mixing them up silently breaks things.
- **`AffectsSavedGames=0`** is essential for a cheat panel — enabling/disabling between sessions does not corrupt saves. Sovereign Cheat Panel uses this.
- **`<LoadOrder>`**: higher = later. Use ≥100 if you decorate base-game UI files.

### 1.4 Civ 7 vs Civ 6 modding model
| Aspect | Civ 6 | Civ 7 |
|---|---|---|
| Gameplay scripting | Lua | **JavaScript only**, in the UI / Tuner V8 isolate. No separate Lua gameplay layer. No equivalent of Civ 6's `<GameplayScripts>`. |
| UI | Forge/Lua/XML | **HTML + CSS + JS** rendered by Coherent UI with ESM modules and a chunk-bundle system |
| Modifier framework | Yes (XML modifiers + game-effects) | **Carried over and expanded.** Still the safest way to make gameplay changes that survive MP and saves. |
| Mod tools | ModBuddy, official map editor | No ModBuddy. FireTuner returns. SDK has a mod uploader. No official map editor as of Test of Time. |
| MP scripting | Some scripts unsafe in MP | **All gameplay-affecting JS is effectively client-side state mutation.** Cheat panels are SP only — they don't sync. |

**SP vs MP safety:** anything that calls `Player.Treasury.changeGoldBalance(...)` from a client UI script in MP will either desync or be rejected by the host. Gate every action behind `if (Game.maxPlayers > 1) return;` or hide the panel outside SP. Sovereign's mod page is explicit: "designed for single-player only — please disable before ranked, hotseat, or competitive matches."

### 1.5 What the JS modding layer can and cannot do
Moddable from JS today:
- All Player/Treasury/Stats yields (gold, influence, science/culture/happiness/etc.)
- Tech/civic progress (direct mutation on `Player.Techs` / `Player.Culture`)
- Unit XP, damage/heal, movement points, promotions
- Unit creation/deletion
- City production progress, population (via `City.Growth`)
- Plot terrain/feature/resource/biome via `WorldBuilder.MapPlots.*` (works at runtime)
- All UI: registering panels, sub-system dock hooks, hotkey bindings

**Not** moddable from pure JS (per Sovereign Cheat Panel author):
- Declaring war or forcing treaties
- Direct fog-of-war reveal flag (no `Visibility.revealPlot` exposed; the engine debug menu uses internal C++)
- Wholesale natural-wonder placement at runtime
- Anything requiring an art-pipeline asset not already shipped

---

## 2. The UI Scripting Layer

### 2.1 Coherent UI / HTML+JS framework
Civ 7's in-game UI is rendered by **Coherent UI** (a Chromium-based embedded browser) running on **Google's V8** engine. There are at least two V8 isolates: one for **Tuner** (FireTuner debug console) and one for **App UI**. Your mod's JS runs in the App UI isolate and reads/writes engine state through exposed globals.

The UI is built from Civ-specific HTML custom elements (already defined in the base game):
- `<fxs-frame>`, `<fxs-inner-frame>`, `<fxs-subsystem-frame>` — chrome / panels
- `<fxs-tab-bar>` — tabbed layouts
- `<fxs-stepper>` — numeric steppers (configurable cheat amounts)
- `<fxs-button>`, `<fxs-checkbox>`, `<fxs-dropdown>`
- `<fxs-list>` — virtualized lists (use for unit/city lists)

Inspect them by reading `Base\modules\core\ui\components\*.js` and `Base\modules\base-standard\ui\**\*.js`.

### 2.2 Module structure — ESM with chunk imports
Civ 7's UI JS ships as **ES modules**. Base-game import paths look like:
```js
import ContextManager  from '/core/ui/context-manager/context-manager.js';
import FocusManager    from '/core/ui/input/focus-manager.js';
import { P as Panel }  from '/core/ui/panel-support.chunk.js';
import DialogBoxManager from '/core/ui/dialog-box/manager-dialog-box.chunk.js';
import { Icon }        from '/core/ui/utilities/utilities-image.chunk.js';
```
The `.chunk.js` files are bundle-split exports where symbols are aliased (`P as Panel`, `b as InputEngineEventName`). **These aliases change with every patch.** Every Civ 7 UI mod has historically broken on patches that re-bundle these chunks — per CivFanatics user "breaches" on the Rayoz12 thread page 10: "The original cheat-panel.js imported from 4 core UI modules that Firaxis renamed to .chunk.js files back in 1.2.4." Subsequent breaks followed at 1.3.2 and 1.4 (Test of Time). **Isolate import statements in one file per module** so chunk-alias updates are a small diff.

The `imports.json`-style indirection in `Base/modules/*/scripts/` is just a directory manifest — the engine builds an in-memory loader map from your `<UIScripts>` and `<ImportFiles>`.

### 2.3 Registering UI — hooking the sub-system dock
The canonical pattern (Rayoz12 / Sovereign):

1. `<UIScripts>` includes a small `cheat-panel-dock-decorator.js`.
2. It imports the base dock module and **monkey-patches** its render to inject an extra button (a gold-skull icon for Sovereign, the religion icon clone for Rayoz12 MVP).
3. Click handler calls `ContextManager.push("cheat-panel", { singleton: true, createMouseGuard: true })`.
4. `ContextManager` instantiates your `<cheat-panel>` custom element against your HTML template.

Hotkey (F8) via Civ 7's input-action system:
```xml
<!-- data/input-bindings.xml: UpdateDatabase -->
<Database>
  <ActionGroupBindings>
    <Row ActionGroup="ACTION_GROUP_BINDING_INGAME" Action="open-cheat-panel" />
  </ActionGroupBindings>
  <Actions>
    <Row Action="open-cheat-panel" Category="SHELL" />
  </Actions>
  <Bindings>
    <Row Action="open-cheat-panel" Device="KBM" Input="KEYBOARD_F8" />
  </Bindings>
</Database>
```
In JS:
```js
window.addEventListener('engine-input', (e) => {
  if (e.detail.name === 'open-cheat-panel') toggleCheatPanel();
});
```
With this approach the user can rebind in the standard Civ 7 keybinding screen.

### 2.4 Exposed engine globals
The App UI isolate exposes (non-exhaustive; see `API_LIBRARY.md` in `ghost-ng/FiretunerTerminal` for the broader extract):
- **`Game`** — `Game.maxPlayers`, `Game.localPlayerID`, `Game.PlayerOperations`, `Game.UnitCommands`, `Game.UnitOperations`, `Game.WorldBuilder`, `Game.Resources`.
- **`Players`** — `Players.get(id)` → `.Treasury`, `.Stats`, `.Techs`, `.Culture`, `.Units`, `.Cities`, `.Diplomacy`, `.Resources`. `Players.getAliveMajorIds()`.
- **`Units`** — `Units.get(id)` → `.Experience`, `.Health`, `.Movement`, `.Combat`, `.location`.
- **`Cities`** — `Cities.get(id)` → `.Growth`, `.BuildQueue`, `.Yields`, `.population`, `.isCapital`, `.location`.
- **`GameplayMap`** — read-only plot accessors: `getTerrainType`, `getFeatureType`, `getResourceType`, `getBiomeType`, `getGridWidth`, `getGridHeight`, `isCoastalLand`, `isWater`, `getOwner`, `getDistrict`.
- **`WorldBuilder.MapPlots`** — **writes**: `setTerrain(hash, loc)`, `setFeature(hash, loc)`, `setResource(hash, loc, amount)`, `setBiome(hash, loc)`, `setFertility(type, loc)`, `setRevealed(playerID, x, y, true)`. `loc = {x, y}`. Hashes via `Database.makeHash("TERRAIN_GRASSLAND")`.
- **`MapConstructibles`** — `addDiscoveryType(Database.makeHash("DISCOVERY_X"), x, y)`.
- **`GameInfo`** — definition tables: `Units`, `Resources`, `Features`, `Terrains`, `Constructibles`, `LegacyCivilizations`, `Improvements`, `Districts`, `Biomes`. Iterable; `GameInfo.Resources.lookup(hash)` returns the row.
- **`UI`** — view helpers: `UI.Player.getHeadSelectedUnit()`, `UI.Cursor`, `UI.Sound.playSound`.
- **`Engine`** — event bus: `Engine.on("CityGrowth", fn)`, `"UnitMoveComplete"`, etc.
- **`Locale`** — `Locale.compose("LOC_KEY_X")`.

---

## 3. Specific APIs Per Cheat Feature

This is the operational lookup table. Signatures sourced from (a) literal quotes of Rayoz12's source in forum fix threads, (b) Enio's WorldBuilder snippets, (c) engine namespaces extracted from the App UI isolate. Signatures inferred from feature behavior + naming convention are marked **(inferred)**.

### 3.1 Resources (gold, influence, yields)
```js
const localID = GameContext.localPlayerID;
const player  = Players.get(localID);

// Gold — literal from Rayoz12 cheat-panel.js (breaches 1.3.2 fix):
player.Treasury.changeGoldBalance(1000, -1);  // amount, YieldSourceType (-1 = no source)

// Influence / other yields (inferred — sibling method):
player.Stats.changeYieldStockpile(YieldTypes.YIELD_INFLUENCE, 100);
player.Stats.changeYieldStockpile(YieldTypes.YIELD_SCIENCE, 500);
player.Stats.changeYieldStockpile(YieldTypes.YIELD_CULTURE, 500);
```
Iterate `GameInfo.Yields` for the full list. Passing `-1` as YieldSourceType means "untracked source"; a real source makes the breakdown tooltip attribute the gain.

### 3.2 Map reveal / fog of war
There is **no single `VisibilityManager.revealAll()` exposed to JS.** Two working paths:

A. **Engine debug toggle** (zero-code, requires `EnableDebugPanels 1` in `AppOptions.txt`): tilde → Map tab → Reveal All / Explore All / Enable FOW.

B. **Per-plot iteration** via WorldBuilder:
```js
const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
const localID = GameContext.localPlayerID;
for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
  WorldBuilder.MapPlots.setRevealed(localID, x, y, true);  // (inferred)
}
```
Performance is fine on standard maps. **Recommendation:** leave fog reveal to the engine debug menu and don't ship it in the cheat panel — Sovereign does not, for this reason.

### 3.3 Instant-finish research / civic
```js
const player = Players.get(GameContext.localPlayerID);

// Tech:
const techNode = player.Techs.getResearchingNode();           // (inferred)
const cost     = player.Techs.getResearchCost(techNode);
player.Techs.setResearchProgress(techNode, cost);             // (inferred — completes node)

// Civic:
const civicNode = player.Culture.getResearchingNode();
player.Culture.setResearchProgress(civicNode, player.Culture.getResearchCost(civicNode));
```
Real method names live in `Base\modules\base-standard\ui\tech-tree\` and `…\culture-tree\` — read those because the namespace was renamed at 1.3.

### 3.4 Unit infinite movement (toggle)
There is no native infinite-movement flag. Pattern that works (ports cleanly from the Civ 6 "Cheat Menu For Units" workshop mod):
```js
const infiniteMoveUnits = new Set();  // unitIDs

// One-shot:
function restoreMovement(unitID) {
  Units.get(unitID).Movement.restoreMovement();  // (inferred)
}

// Persistent toggle:
Engine.on("PlayerTurnBegan", (data) => {
  if (data.player !== GameContext.localPlayerID) return;
  for (const id of infiniteMoveUnits) {
    const u = Units.get(id); if (u) u.Movement.restoreMovement();
  }
});
Engine.on("UnitMoveComplete", (data) => {
  if (infiniteMoveUnits.has(data.unitID)) Units.get(data.unitID).Movement.restoreMovement();
});
```
**Known cosmetic bug** (carried over from Rayoz12): the unit's MP indicator in the unit panel doesn't refresh until the unit is reselected. Workaround in the cheat panel: after restore, call `UI.Player.deselectAllUnits()` then `UI.Player.selectUnit(unitID)`.

### 3.5 Unit duplication, heal, XP, deletion, promote
```js
const u = Units.get(UI.Player.getHeadSelectedUnit());

// Heal fully (inferred):
u.Health.changeDamage(-u.Health.damage);

// XP (commanders only get meaningful effect):
u.Experience.changeExperiencePoints(1000);

// Promote — via UnitCommands RPC:
Game.UnitCommands.sendRequest(u.id, "UNITCOMMAND_PROMOTE", { PromotionType: "..." });

// Delete:
Game.UnitCommands.sendRequest(u.id, "UNITCOMMAND_DELETE", {});

// Duplicate at same plot (or adjacent if occupied):
const player = Players.get(u.owner);
const newUnit = player.Units.addUnitToMap(u.unitType, u.location);  // (inferred)
for (const p of u.Experience.getPromotions()) {
  Game.UnitCommands.sendRequest(newUnit.id, "UNITCOMMAND_PROMOTE", { PromotionType: p.type });
}
```
**Command vs operation distinction:** `Game.UnitCommands.sendRequest` = atomic instant unit commands (delete, promote, fortify). `Game.UnitOperations.sendRequest` = multi-turn/pathed operations (move, attack, range-attack). Both share signature `sendRequest(target, type, args)`.

### 3.6 City management
```js
const city = Cities.get(cityID);

// Population (Rayoz12 v0.0.4 added this):
city.Growth.addPopulation(1);                    // (inferred)
// or: city.Growth.changeUrbanPopulation(1); / changeRuralPopulation(1);

// Instant-complete current production:
const queue = city.BuildQueue;
const item  = queue.getCurrentProductionTypeHash();
queue.addProgress(queue.getProductionCostForCurrentItem(item));   // (inferred)

// Iterate all cities of local player:
const ids = Players.get(GameContext.localPlayerID).Cities.getIds();
for (const id of ids) { /* ... */ }
```
Stored gold is at player level (`Treasury`), not per-city; city yields are rates, mutate via Player.Stats modifiers.

### 3.7 Map tile modification — actually works at runtime
**Most modders assume "you can't" — but you can.** Enio's Map Cheat Panel proves it. Literal API from his debug script:
```js
const loc = { x, y };

WorldBuilder.MapPlots.setTerrain(Database.makeHash("TERRAIN_GRASSLAND"), loc);
WorldBuilder.MapPlots.setFeature(Database.makeHash("FEATURE_FOREST"), loc);
WorldBuilder.MapPlots.setResource(Database.makeHash("RESOURCE_IRON"), loc, 4);  // amount int
WorldBuilder.MapPlots.setBiome(Database.makeHash("BIOME_TROPICAL"), loc);
WorldBuilder.MapPlots.setFertility(fertilityType, loc);  // rarely succeeds

MapConstructibles.addDiscoveryType(Database.makeHash("DISCOVERY_X"), loc.x, loc.y);
```
**Caveats:**
1. Change is persisted **only if internally valid** — you cannot put `FEATURE_FOREST` on `TERRAIN_OCEAN`; the next-turn validator strips invalid combos. Set terrain/biome before feature/resource.
2. **Graphic refresh:** changing terrain at runtime updates data but may not re-render the visual mesh until save+reload. Known Civ 5/6 quirk that persists. Sidestep: tell the user visuals refresh after a turn rollover.
3. **Adjacency-bonus stale risk:** changing a feature adjacent to a Campus/Holy-Site/etc. won't retroactively recompute the district's adjacency yield until rebuild or reload. For SP cheat panel this is acceptable.
4. **Natural wonders:** placement validator is much stricter. Single-tile discovery-style works via `MapConstructibles.addDiscoveryType`; multi-tile wonders are not safely placeable from JS at runtime.

Pre-game alternative if runtime is too flaky: write a **map-script mod** (separate `.modinfo` with `<Maps>` referencing a `*-map.js`) running at world-gen.

### 3.8 Adding constructibles / improvements
```js
Game.PlayerOperations.sendRequest(localID, "PLAYER_BUILD_CONSTRUCTIBLE", {
  ConstructibleType: Database.makeHash("IMPROVEMENT_FARM"),
  X: x, Y: y
});
```
For wonders, route through `City.BuildQueue` then complete (§3.6). Direct world-placement of named wonders is gated on tile-ownership state and the most patch-fragile op — wrap in `try/catch`.

---

## 4. Existing Open-Source Cheat Mods

### 4.1 Rayoz12's Cheat Panel
- **Source:** https://forums.civfanatics.com/resources/rayoz12s-cheat-panel.31952/ — discussion at .../threads/rayoz12s-cheat-panel-mod.695815/
- **Status (May 2026):** original author last updated **v0.0.4 on Feb 22, 2025** per civfanatics.com/resources/rayoz12s-cheat-panel.31952/updates; as of May 2026 the resource page shows **23,807 downloads** and **4.29 stars from 21 ratings**. Kept alive by community fixes — most recent maintained fork is "Rayoz12 Cheat Panel — Compatibility for Civ 7 (v1.4 Test of Time)" credited to Kevroids, Civ7CanFan, and breaches (forum thread page 10).
- **Features:** +1000 gold, +1000 influence, +1 wildcard attribute point, restore selected-unit movement, heal selected unit, give XP (commanders), complete selected city production, +1 population to selected city, complete current researching tech, complete current civic. F8 hotkey (later F10 in v1.4 fork).
- **Architecture:** single `cheat-panel.js` (~400 lines, mostly button handlers calling engine APIs directly), one HTML panel template, one CSS file, hooks the sub-system-dock by replacing the religion-icon button. Imports `panel-support.chunk.js`, `manager-dialog-box.chunk.js`, `utilities-dom.chunk.js`, `focus-manager.js`, `utilities-image.chunk.js`.
- **Code quality:** functional, minimal abstractions, no TypeScript, no unit/city iteration panels. Has historically broken on every Firaxis patch because of chunk-import alias drift. Each fix has been a 5-line import rewrite + occasional method-rename.
- **Missing vs your scope:** no multi-unit panel, no multi-city panel, no map tile editing, no infinite-movement toggle (only one-shot restore), no per-row UI.

### 4.2 Sovereign Cheat Panel (Nexus mod 22, "notr00tt")
- **Source:** https://www.nexusmods.com/civilizationvii/mods/22 — released Feb 19, 2026; updated May 21, 2026 for Test of Time.
- **Features:** Four-tab layout (Player / Units / Cities / Research), configurable amounts via `fxs-stepper` across five different cheats, bulk variants gated by confirmation dialogs, gold-skull launcher on the sub-system dock + F8 hotkey, draggable panel position. Built natively against Test-of-Time UI primitives (`fxs-tab-bar`, `fxs-inner-frame`, `fxs-stepper`, `fxs-subsystem-frame`, `DialogBoxManager`).
- **Architecture:** modular by tab — separate JS file per tab, shared frame/launcher code. Uses Test-of-Time `fxs-*` custom elements throughout, so UI is visually native. Declares `AffectsSavedGames=0`. Targets Test-of-Time only — pre-1.4 unsupported.
- **Code quality:** by far the most polished public cheat panel. Engine-standard panel primitives, proper confirmation dialogs, configurable steppers replace magic numbers. Conflicts: anything else overriding `base-standard/ui/sub-system-dock/panel-sub-system-dock.js`.
- **Missing vs your scope:** **no per-row unit-management list** (only bulk all-unit), **no per-row city-management list**, **no map tile editing**. Author explicitly excludes war/treaties as not currently moddable.

### 4.3 Izica's Dev/Cheat Panel
- **Source:** https://forums.civfanatics.com/resources/izicas-dev-panel.32384/ — also Steam Workshop ID 3506929756 (titled "Izica's dev/cheat panel [1.2.4]", now flagged "This item is incompatible with Sid Meier's Civilization VII" — broken on later patches). Revived as "Izica's Dev/Cheat Panel (fixed)" by Lottililex (Feb 2026).
- **Features:** Toggle hotkey "B", panel resize (Ctrl+0/Ctrl+9), credits Rayoz12. Configurable hotkeys, auto-meet-all-leaders, spawn-settler-in-capital, age-transition button, +100 Happiness start celebration.
- **Architecture:** heavier dev-tooling slant than Rayoz12, same single-file pattern. Author maintains `civ7-modding-tools` TypeScript framework.
- **Missing vs your scope:** unit list, city list, map tile editor.

### 4.4 Map Cheat Panel (Enio)
- **Source:** https://forums.civfanatics.com/resources/map-cheat-panel.32386/ — May 2025, ~16 ratings, 4.06 stars. Discussed at https://forums.civfanatics.com/threads/unofficial-map-editor-wip.695900/.
- **Features:** Edit terrain / feature / resource / biome on selected tiles **at runtime during normal play.** The mod that proves `WorldBuilder.MapPlots.set*` works mid-game.
- **Architecture:** uses `ChoosePlotInterfaceMode` for plot selection, then calls WorldBuilder mutation API. Compact and well-isolated — good study artifact.
- **Missing vs your scope:** nothing — it is the feature complement to Sovereign. Pull its plot-selection pattern verbatim.

### 4.5 Recommendation — fork target
**Fork Sovereign Cheat Panel** as the skeleton. Reasons:
1. Already built on Test-of-Time UI primitives.
2. Modular tab structure cleanly accommodates two more tabs (Unit-list, City-list, Map) without restructuring.
3. `AffectsSavedGames=0` and SP-only baked in.
4. Confirmation-dialog pattern for bulk-destructive actions present.

Caveats: Sovereign's Nexus permissions state "you must get permission from me before you are allowed to modify my files." For a private working copy this is moot; if you intend to publish a derivative, contact `notr00tt` first. If permission is not granted, fork **Rayoz12** instead — community maintainers have effectively re-licensed it and it's the de-facto template (Izica explicitly credits it). The architectural cost is rebuilding tabbing/stepper/dialog scaffolding (~300 LOC).

**What to build on top of Sovereign:**
- **Unit Management panel (new tab):** iterate `Players.get(localID).Units.getUnits()`, render `<fxs-list>` of rows with [name, location, HP, MP] + buttons [Heal, +XP, Promote, Delete, Restore Movement, ∞ Movement toggle]. Click row → `UI.Camera.lookAtPlot(loc)`.
- **City Management panel:** iterate `Players.get(localID).Cities.getIds()`. Rows: [name, population, capital marker, current production, growth progress]. Buttons: [Set Population stepper, Instant Complete Production, +N Gold, Set Yield Rate via modifiers].
- **Map Management panel:** integrate Enio's `ChoosePlotInterfaceMode` flow. Sidebar selectors populated from `GameInfo.Terrains` / `Features` / `Resources` / `Biomes`. "Paint" mode applies selection to clicked plot.
- **Infinite-movement toggle:** state in module scope, hook on `PlayerTurnBegan` + `UnitMoveComplete` (§3.4).
- **Unit duplication:** addUnitToMap + promotion-copy (§3.5).

Estimate: ~1500–2500 LOC TS/JS, 1–2 weeks of evening work for a competent JS dev.

---

## 5. Modding Tooling

### 5.1 izica/civ7-modding-tools (TypeScript)
- **Repo:** https://github.com/izica/civ7-modding-tools — also a divergent fork at https://github.com/mateicanavra/civ7-modding-tools that bundles SDK, CLI, plugins, Mintlify docs site (civ7community.mintlify.app).
- **What it is:** a TS framework that programmatically generates `.modinfo`, XML, SQL via builders (`UnitBuilder`, `CivilizationBuilder`, `LeaderUnlockBuilder`, `ProgressionTreeNodeBuilder`, etc.).
- **When to use:** **content mods** (new civs, units, traditions, modifiers). Not relevant for a UI-only cheat panel — it doesn't generate UIScript. **For your project, skip it.** Write `.modinfo` by hand (~50 lines) and write JS/TS UI files directly.
- **When it might help later:** if you add a custom Civilization or Leader for sandbox testing alongside the cheat panel.

### 5.2 Official Civ 7 Modding SDK
- Steam → Library → Tools → "Sid Meier's Civilization VII - Development Tools."
- **Includes:** FireTuner, mod uploader (Workshop), example mods, documentation files inside the SDK install.
- **Does not include:** art tools, Coherent UI inspector, JS debugger UI.
- Read the bundled docs first — they have the most accurate `.modinfo` schema reference.

### 5.3 FireTuner — debug console
Step-by-step (Windows):
1. Set `EnableTuner 1` and `EnableDebugPanels 1` in `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\AppOptions.txt` (uncomment too). Or pass `-EnableDebugPanels 1 -EnableTuner 1` as Steam launch options (avoids file being overwritten on game start).
2. Launch FireTuner from the SDK tools.
3. Start a Civ 7 game. FireTuner shows "Connected" bottom-left.
4. Lua States dropdown is empty — pick **"Tuner"** context. Refresh.
5. Civ 6 tuner panels still work for **some** Civ 7 panels at `…\Civilization VII\Base\Platforms\Windows\Config\TunerPanels\`. Autoplay works; some others don't.
6. JS input: `console.log("hello")` — output appears in `UI.log`, not the tuner window directly.

The tuner is a read/eval/print loop against the running game — invaluable for figuring out exact method signatures by inspecting live objects:
```js
JSON.stringify(Object.getOwnPropertyNames(Players.get(0).Treasury))
```
dumps real method names against the current patch.

### 5.4 In-game debug console
With `EnableDebugPanels 1`: open with `~` or `'`. Provides:
- Map → Reveal All / Explore All / Enable FOW toggle
- UI → Gameplay → Force Age Transition
- UI → Console → **reload** button that hot-reloads UI scripts without restarting (log severity output is glitched, but reload works).
- The in-game debug console has been broken in some patches and fixed in others. Tracker: https://forums.civfanatics.com/threads/how-to-enable-the-in-game-console.694859/

### 5.5 FiretunerTerminal — recommended power-user setup
**Source:** https://github.com/ghost-ng/FiretunerTerminal
Third-party Python replacement for the SDK FireTuner UI, communicating with Civ 7 over **binary messages on TCP port 4318**: `[4 bytes: length, little-endian] [4 bytes: type=3, little-endian] [CMD:65535:{your javascript here}\0]` (per the FiretunerTerminal README). Advantages:
- Real command history, multiline JS, copy/paste.
- `extract_types` script parses unpacked game JS, produces `completions.json` for Tab-completion of every exposed global and method.
- Ships `API_LIBRARY.md` summarizing GameplayMap, Players, Game, cities, units, diplomacy.
- **MCP server included** — Claude Code / Cursor can `execute_js` directly against the running game from inside your editor. Closest thing to a Civ 7 REPL.

### 5.6 IDE setup
- **VS Code** + ESLint, Prettier, XML Language Support (Red Hat). Optional: TypeScript with `civ7-modding-tools/src` in `tsconfig.json` paths for types.
- Treat unpacked `Base\modules\**\*.js` as read-only reference workspace. You will spend most debugging time searching it.
- Community type stubs at `mateicanavra/civ7-modding-tools/packages/sdk` give some autocomplete.
- File watcher: `chokidar-cli` / `nodemon` / `npm run watch` that syncs `dist/` to the Mods directory on save. Hot-reload requires the in-game console's reload button, not just save in editor.

### 5.7 Hot reload / live debugging
- **JS reload mid-game:** in-game console → UI → Console → "Reload UI." Reloads UIScripts; **does not** re-evaluate `.modinfo` (no new files, no DB changes). Works for iterating cheat-panel logic.
- **Full reload:** required for `.modinfo` / XML / SQL / new file additions. Quit to main menu → quit to desktop → restart. (Main-menu quit alone does not re-parse.)
- **Browser-style devtools:** **not exposed.** Coherent UI has a remote inspector but Firaxis hasn't enabled it. Your debug surface is `console.log` → `UI.log` plus FireTuner. Get comfortable with `console.error("CHEAT_PANEL: " + JSON.stringify(x))`.

---

## 6. Map / Tile Modification Deep Dive

(Runtime API in §3.7.) Additional notes for your Map Management panel:

### 6.1 Plot read API
```js
const t = GameplayMap.getTerrainType(x, y);     // hash
const tDef = GameInfo.Terrains.lookup(t);        // { TerrainType: "TERRAIN_GRASSLAND", Hills: 0, ... }
const f = GameplayMap.getFeatureType(x, y);
const r = GameplayMap.getResourceType(x, y);
const b = GameplayMap.getBiomeType(x, y);
const isWater = GameplayMap.isWater(x, y);
const isCoast = GameplayMap.isCoastalLand(x, y);
const owner   = GameplayMap.getOwner(x, y);
const district = GameplayMap.getDistrict(x, y);  // urban/rural/wilderness
```

### 6.2 Enum tables
- `GameInfo.Terrains` — TERRAIN_GRASSLAND, PLAINS, DESERT, TUNDRA, SNOW, COAST, OCEAN + hill/mountain variants
- `GameInfo.Features` — FOREST, RAINFOREST, MARSH, REEF, FLOODPLAINS, OASIS, VOLCANO + per-civ natural wonders
- `GameInfo.Resources` — bonus/strategic/luxury; `.lookup(hash).ResourceClassType`
- `GameInfo.Feature_NaturalWonders` — wonder subset of features (often multi-tile, validated)
- `GameInfo.Biomes` — BIOME_TROPICAL, TEMPERATE, GRASSLAND, TUNDRA, etc.
- `GameInfo.Constructibles` — improvements + buildings + wonders, with `ConstructibleClass`
- `GameInfo.Improvements` — rural-only worker-improvement subset

### 6.3 Visual refresh (known problem)
Civ 6/7 engine: "The game engine can't update terrain graphic change on the fly ATM, the only time the graphics of terrains are updated is during game loading." For your Map tab:
1. User selects terrain, clicks tile.
2. You call `WorldBuilder.MapPlots.setTerrain(...)`.
3. **Show a banner**: "Visuals will refresh next turn / on save+reload." Features and resources do refresh; terrain often does not.
4. Experiment in FireTuner with broadcasting `Engine.broadcastEvent("PlotChanged", { x, y })` to force refresh — undocumented but worth trying.

### 6.4 Worldbuilder mode
Civ 7 ships a hidden worldbuilder mode but lacks a polished UI. Most of `WorldBuilder.*` is accessible from JS at any time, not gated on worldbuilder mode. Check `Game.WorldBuilder.isActive()` only if you hit a gate — `MapPlots.set*` has not required it in the current patch.

### 6.5 Natural wonder placement
- **Single-tile:** try `MapConstructibles.addDiscoveryType(hash, x, y)` after clearing the tile (`setFeature(0, loc)` + compatible terrain).
- **Multi-tile:** **don't attempt at runtime.** Placement-rule validator runs only at map gen and refuses mid-game. If the user really needs Pantanal / Galápagos, regenerate a map with seed control.
- **Civ7Map by vimontgames** (https://github.com/vimontgames/civ7tools, https://forums.civfanatics.com/resources/civ7map-unofficial-map-editor.32103/) is a standalone Windows app for pre-game map editing including natural-wonder placement. Exports YnAMP-compatible `*-map.js` that the game loads as a map script. Canonical fallback when runtime placement isn't viable.

---

## 7. Windows / Shadow PC Development Workflow

### 7.1 Filesystem layout
- Mods: `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Mods\`
- Logs: `…\Civilization VII\Logs\`
- App options: `…\Civilization VII\AppOptions.txt`
- Game install (Steam default): `C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\Base\`
- DLC: `…\Civilization VII\DLC\`
- Tuner panels (legacy): `…\Civilization VII\Base\Platforms\Windows\Config\TunerPanels\`

### 7.2 Recommended iteration loop
1. Edit `.js` / `.html` / `.css` in your repo (outside Mods folder).
2. Watcher syncs to `…\Mods\<your-mod-name>\` on save (rsync-style).
3. In Civ 7: `~` → UI → Console → Reload (JS-only changes).
4. For `.modinfo` / XML / SQL: quit to desktop, relaunch.
5. Tail `UI.log` and `Database.log` continuously (`Get-Content -Wait`).

### 7.3 Shadow PC specifics
- Shadow PC runs Windows; paths identical.
- Latency mostly affects gameplay (camera pan, click latency) — not iteration, since edits happen on the Shadow disk locally to the running game.
- Edit on local via VS Code Remote-SSH if Shadow allows; otherwise edit directly on the Shadow desktop. Source control via `git push/pull` from the Shadow box.
- Coherent UI input is sensitive to remote-desktop frame drops; "F8 sometimes doesn't fire" is usually streaming hiccup, not your binding.

---

## 8. Architecture Recommendations

### 8.1 Folder layout (proposed)
```
local-cheat-panel/
├── cheat-panel.modinfo
├── data/
│   ├── input-bindings.xml         ← F8 + sub-keys per panel
│   └── ui-text.xml                ← LOC_ strings
├── ui/
│   ├── cheat-panel/
│   │   ├── cheat-panel.html       ← root frame, fxs-tab-bar
│   │   ├── cheat-panel.css
│   │   ├── cheat-panel.js         ← root: tab routing + global state
│   │   ├── dock-decorator.js      ← injects launcher into sub-system dock
│   │   ├── shared/
│   │   │   ├── state.js           ← module-scoped Map<unitID, toggle> etc.
│   │   │   ├── api.js             ← thin wrappers around engine APIs
│   │   │   └── widgets.js         ← reusable row, stepper-row, dialog helpers
│   │   ├── tab-player.js          ← gold/influence/yields steppers
│   │   ├── tab-units.js           ← unit list + per-row actions
│   │   ├── tab-cities.js          ← city list + per-row actions
│   │   ├── tab-research.js        ← instant tech/civic
│   │   └── tab-map.js             ← plot-paint mode + selectors
│   └── icons/
│       └── cheat-icon.png
└── README.md
```

### 8.2 Cross-panel state
Module-scoped state in `shared/state.js`. **Do not** put it on global `window` (collides with other mods). State survives panel-open events because `ContextManager.pop("cheat-panel")` destroys DOM but the JS module stays warm.

For state that should survive save/load: write to **shared plugin data** via `getSharedPluginData / setSharedPluginData` with a stable namespace (e.g. `"localcheatpanel.v1"`). Civ 7's equivalent of save-attached metadata. With `AffectsSavedGames=0`, treat saved data as transient hints not authoritative state.

### 8.3 Hotkey design
- F8 = open/close main panel.
- Within panel, NavTray-style: 1–5 cycle tabs.
- ESC closes (ContextManager wires this).
- Avoid binding bare letter keys (collide with T, C, etc.).
- All bindings in `data/input-bindings.xml` so users rebind via standard keybinding screen.

### 8.4 Sub-system dock launcher
The decorator pattern:
```js
import { decoratePanel } from '/core/ui/decorate.chunk.js';  // verify name in current patch
decoratePanel("panel-sub-system-dock", (proto) => {
  const origRender = proto.render;
  proto.render = function() {
    const root = origRender.call(this);
    const btn = document.createElement("fxs-button");
    btn.setAttribute("data-icon", "fs://game/local-cheat-panel/icons/cheat-icon");
    btn.addEventListener("click", () =>
      ContextManager.push("cheat-panel", { singleton: true, createMouseGuard: true })
    );
    root.querySelector(".sub-system-dock-row").appendChild(btn);
    return root;
  };
});
```
If `decoratePanel` isn't exposed under that name, fall back to the Rayoz12 approach: import the dock JS via `<ImportFiles>` (not `<UIScripts>`), then `<UIScripts>` a replacement that re-exports a patched version. Fragile across patches; decorator preferred when available.

### 8.5 Conflict avoidance
Biggest conflict source: multiple mods overriding the same dock panel (Sovereign calls this out for `base-standard/ui/sub-system-dock/panel-sub-system-dock.js`). Strategies:
1. **Prefer decoration over replacement.**
2. **Detect conflicts at runtime** — if your launcher button doesn't appear after 1 s post-mount, log a warning to `UI.log` and offer a hotkey-only fallback.
3. **Document compatibility** in mod description — list base files you touch.

### 8.6 Save-game compatibility
- Declare `AffectsSavedGames=0`.
- Don't store mod-specific data in player/unit/city state that would persist after the mod is uninstalled.
- Infinite-movement toggle state lives in module memory only — when mod is disabled, toggle is implicitly cleared.
- Plot tile changes via WorldBuilder DO persist in the save. If the mod is later removed, the modified plots remain. This is intentional — the user wanted to change the world.

### 8.7 Logging convention
Prefix everything with the mod name so you can grep `UI.log`:
```js
const LOG = (...args) => console.log("LCP:", ...args);
const ERR = (...args) => console.error("LCP:", ...args);
```
Sovereign follows this; Rayoz12 doesn't, making log triage harder when multiple mods are loaded.

---

## 9. Recommended Starting Point

**Fork Sovereign Cheat Panel** (with author permission if redistributing; otherwise as a private working copy). Reasons recapped in §4.5.

**Concrete first steps:**
1. Install Civ 7 + SDK on Shadow. Enable `EnableDebugPanels 1` and `EnableTuner 1`.
2. Set up FiretunerTerminal locally. Use it to dump live signatures of `Players.get(0).Treasury`, `.Stats`, `.Techs`, `.Culture`, `.Cities`, `.Units` against your current patch. Save in `docs/api-snapshot-<patch>.md` as a fixed reference.
3. Drop unmodified Sovereign into `…\Mods\` to verify toolchain end-to-end.
4. Copy Sovereign's folder to a fresh `local-cheat-panel/` workspace. Change `Mod id`, `Name`, all loc strings.
5. Implement **Units tab** first — highest-value missing feature, exercises the most APIs. Reuse Sovereign's stepper/dialog widgets.
6. Implement **Cities tab** next with same patterns.
7. Implement **Map tab** last by porting Enio's `WorldBuilder.MapPlots.set*` into a plot-paint interface-mode flow. Test on fresh game before any production save.
8. Wire infinite-movement toggle via `PlayerTurnBegan` + `UnitMoveComplete` (§3.4).
9. Hot-reload via in-game console as you iterate.

Estimate: 1–4 in an evening (mostly waiting on installs), 5–6 in 2–4 evenings each, 7 in 3–5 evenings (map-paint UX has more edge cases). 8–9 are <1 hour once the rest works.

---

## 10. Known Unknowns / Risks

1. **Exact method names drift across patches.** `changeGoldBalance` has been stable, but `restoreMovement`, `setResearchProgress`, `addPopulation`, `addUnitToMap` are all inferred from feature behavior + naming convention rather than literally documented. Dump live object methods in FireTuner against your patch before committing. Maintain an `api-snapshot.md` per Civ version.
2. **Chunk import aliases shift every patch.** `panel-support.chunk.js`'s `{ P as Panel }` was different in earlier patches; the original cheat-panel.js broke at 1.2.4 when Firaxis "renamed 4 core UI modules to .chunk.js files," and again at 1.3.2 and 1.4. Isolate imports to one file. Expect ~30 min fix per major patch.
3. **`Visibility.revealPlot` is not confirmed exposed to JS.** Engine debug "Reveal All" is C++. Per-plot `setRevealed` is in `WorldBuilder.MapPlots` but its exact signature (per-player vs global) is uncertain. Consider not shipping this in the cheat panel — point users at `EnableDebugPanels 1` instead.
4. **Natural-wonder runtime placement is patchy.** Single-tile discovery works via `MapConstructibles`. Multi-tile effectively does not. Don't promise it in your UI.
5. **Terrain visual refresh** is not guaranteed after `setTerrain` mid-game. Banner the limitation; recommend save+reload to materialize.
6. **`Game.PlayerOperations.sendRequest` / `Game.UnitCommands.sendRequest`** are real, but precise `PlayerOperationTypes` enum values for "instant complete production" / "delete unit" / "promote unit" are buried in `Base\modules\…\interface-modes\*.js` and unit-action UI scripts. Read those source files; don't invent operation strings.
7. **Wildcard attribute points** (Rayoz12's +1 attribute point) work via a player Stats mutation that has been renamed at least once. Verify before depending.
8. **The in-game debug console is unreliable per patch.** Some patches: working in main menu only, not in-game. Don't depend on it as your only debug channel — `UI.log` + FireTuner is the resilient combination.
9. **`Engine.on` event names** are not exhaustively documented. `"PlayerTurnBegan"`, `"UnitMoveComplete"`, `"CityGrowth"`, `"TileClaimed"`, `"GameStarted"`, `"GameLoaded"` are seen in community code. Listen with `Engine.on("*", e => console.log(e))` in FireTuner to discover others against your patch.
10. **Coherent UI devtools are not exposed**, so DOM/CSS debugging is print-statement + reload driven. Favor very simple flex layouts; avoid complex CSS animations.

---

## Quick Reference

| Need | Call |
|---|---|
| Give gold | `Players.get(id).Treasury.changeGoldBalance(amount, -1)` |
| Give yield | `Players.get(id).Stats.changeYieldStockpile(YieldTypes.X, amount)` |
| Reveal plot | `WorldBuilder.MapPlots.setRevealed(playerID, x, y, true)` |
| Set terrain | `WorldBuilder.MapPlots.setTerrain(Database.makeHash("TERRAIN_X"), {x,y})` |
| Set feature | `WorldBuilder.MapPlots.setFeature(Database.makeHash("FEATURE_X"), {x,y})` |
| Set resource | `WorldBuilder.MapPlots.setResource(hash, {x,y}, amount)` |
| Restore movement | `Units.get(id).Movement.restoreMovement()` |
| Heal | `Units.get(id).Health.changeDamage(-current)` |
| Give XP | `Units.get(id).Experience.changeExperiencePoints(amount)` |
| Spawn unit | `Players.get(id).Units.addUnitToMap(unitType, loc)` |
| Delete unit | `Game.UnitCommands.sendRequest(unitID, "UNITCOMMAND_DELETE", {})` |
| Promote | `Game.UnitCommands.sendRequest(unitID, "UNITCOMMAND_PROMOTE", {PromotionType})` |
| Add pop | `Cities.get(id).Growth.addPopulation(1)` |
| Complete production | `Cities.get(id).BuildQueue.addProgress(cost)` |
| Selected unit | `Units.get(UI.Player.getHeadSelectedUnit())` |
| My cities | `Players.get(GameContext.localPlayerID).Cities.getIds()` |
| Definitions | `GameInfo.Resources.lookup(hash)` / `.Units` / `.Features` / `.Terrains` |
| Plot read | `GameplayMap.getTerrainType(x,y)` / `getFeatureType` / `getResourceType` |
| Hotkey event | `window.addEventListener("engine-input", e => …)` |
| Confirm dialog | `DialogBoxManager.createDialog_Confirm({…})` |
| Open panel | `ContextManager.push("cheat-panel", { singleton: true })` |
| Logs | `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Logs\UI.log` |