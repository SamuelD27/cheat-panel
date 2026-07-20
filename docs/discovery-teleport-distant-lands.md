# Discovery: Cross-Continent Land-Unit Teleport into Distant Lands (Antiquity)

The cheat panel's teleport moves a unit by spawning a fresh same-type unit at the target tile via the native player operation `Game.PlayerOperations.sendRequest(owner, "CREATE_ELEMENT", {Kind:"UNIT", Type:<hash>, Location:{x,y}, Owner:owner, IndependentIndex:-1})` (mod `src/ui/cheat-panel/shared/api.js:293-294`). This works on the player's home continent but **silently seats 0 units** on tiles where `Players.get(owner).isDistantLands({x,y})===true`. The gate is the tile's per-player hemisphere/landmass status (established live this session), not fog-of-war: revealed distant tiles still refuse placement. This document synthesizes a read-only investigation into whether that gate can be bypassed from the mod for a land unit in the Antiquity age. **Version note:** the on-disk base game is patch **1.4.1** (`Info.plist` reports `CFBundleLongVersionString` = "Civilization VII version 1.4.1.30 (1272917)"; Steam `buildid` 24082395), whereas the mod docs cite **1.4.0 / build 23245653**, which matches nothing on disk. Every base-game claim below was re-verified against 1.4.1, but any behavioral claim carried over from the 1.4.0 docs is version-sensitive and flagged where relevant. Note also two path corrections found during investigation: no `*.civdb` files exist anywhere under `Base` (the `base-standard/definitions/*.civdb` path does not exist); the only schema directory on disk is `Base/Assets/schema`.

Throughout, every load-bearing claim is tagged **[VERIFIED]** (a real source line is quoted) or **[INFERRED]** (reasoned, not directly quoted). `isDistantLands`, `CREATE_ELEMENT`, and all placement/`canStart` validation are **native (C++) with no JS/TS/`.d.ts` definition on disk**, so several decisive questions are genuinely unresolvable from source and are marked as needing a live probe.

---

> **Post-synthesis audit (orchestrator, VERIFIED by direct grep 2026-07-14):** load-bearing citations were spot-checked. Confirmed real: the teleport `CREATE_ELEMENT` call site (`api.js:293`), JMK `Teleport="true"` (`age-modern/data/units.xml:281`), the owner-swap payload the base tuner uses (`tuner-input.js:24,31` `args.Owner = selectedPlayer; sendRequest(localPlayerID,"CREATE_ELEMENT",args)`), `TerrainBuilder.setLandmassRegionId` (`map-utilities.js:795`, `elevation-terrain-generator.js:78`), and `Units.create(..., {Validate})` (`age-transition-post-load.js:608`). **Corrected:** four citations to `01_GameplaySchema.sql` and one `RequiresDistantLands` column reference were FABRICATED — no gameplay `*.sql`/`.civdb` schema exists on disk (binary-compiled); those claims now cite the real data rows instead. The substantive verdict is unchanged. One classifier (Rung A, "naval on distant water") failed its structured-output retries in the workflow and returned no row; that candidate is instead covered as **live-probe #7** below.

## Findings per target

### T1 — Base-game access & version

The unpacked 1.4.1 base install is fully readable; the mod docs' 1.4.0/23245653 build is stale.

- **[VERIFIED]** On-disk patch is 1.4.1, not 1.4.0 — `Info.plist`: `<key>CFBundleShortVersionString</key> <string>1.4.1</string>` and `<key>CFBundleLongVersionString</key> <string>Civilization VII version 1.4.1.30 (1272917)</string>`.
- **[VERIFIED]** Steam `appmanifest_1295660.acf:12` `"buildid" "24082395"` (and `TargetBuildID` matches at line 20 — install is up-to-date, not mid-update). This differs from the docs' `23245653`.
- **[VERIFIED]** All five module dirs read (`.../Base/modules`: age-antiquity, age-exploration, age-modern, base-standard, core); base data XML (`AI_Base.xml`, `Barbarians.xml`, `Independents.xml`) reads successfully.
- **[VERIFIED]** No `*.civdb` files exist under `Base` (`find -iname '*.civdb'` → zero matches); only schema dir is `Base/Assets/schema`.
- **[INFERRED]** Any base-game behavioral claim sourced from the 1.4.0 docs (e.g., the exact live `canStart` results, the `WorldBuilder.MapPlots` method set) is version-sensitive and should be re-confirmed on 1.4.1 before being relied on.

### T2 — Mod teleport call site

The mod's teleport path is a minimal `CREATE_ELEMENT` payload with no override keys.

- **[VERIFIED]** `src/ui/cheat-panel/shared/api.js:293-294`: `Game.PlayerOperations.sendRequest(owner, 'CREATE_ELEMENT', { Kind: 'UNIT', Type: utype, Location: { x: loc.x, y: loc.y }, Owner: owner, IndependentIndex: -1 })`.
- **[VERIFIED]** The mod already pre-checks the gate at `api.js:267`: `if (player && typeof player.isDistantLands === 'function' && player.isDistantLands({ x: loc.x, y: loc.y }))`, documenting (lines 261-262) that "CREATE_ELEMENT silently seats 0 units on a Distant Lands tile."

### T3 — How "distant lands" is represented

"Distant" is a **per-player** verdict computed natively from a **persisted per-plot integer `LandmassRegionId`** compared against the player's home hemisphere. It is distinct from both continent identity and the coarser column-based "hemisphere."

- **[VERIFIED]** Per-player query is the native `Players.get(id).isDistantLands({x,y})` — `base-standard/ui/trade-route-chooser/trade-routes-model.js:213`: `const distantLand = localPlayer.isDistantLands(targetCity.location);` (also `resource-layer.js:52`, `plot-tooltip.js:643`).
- **[VERIFIED]** Distant maps to a fixed WEST/home-EAST label (not literal geography) — `plot-tooltip.js:913`: `... isDistantLands() ? "LOC_PLOT_TOOLTIP_HEMISPHERE_WEST" : "LOC_PLOT_TOOLTIP_HEMISPHERE_EAST" ...`.
- **[VERIFIED]** Continent is a separate per-plot value and distant ≠ continent — `continent-layer.js:86` reads `GameplayMap.getContinentType(plotCoord.x, plotCoord.y)`, then `:123` flips a continent's `isDistant` per-plot via `if (!player.isDistantLands(plotCoord)) {`.
- **[VERIFIED]** The underlying datum is `LandmassRegionId`, read at runtime via `GameplayMap.getLandmassRegionId(x,y)` — `maps/map-utilities.js:547`; enum members NONE/ANY (`:548`), DEFAULT (`age-transition-post-load.js:203`), EAST/WEST (`assign-starting-plots.js:245`).
- **[VERIFIED]** The only on-disk **writer** is `TerrainBuilder.setLandmassRegionId(x,y,id)` — `map-utilities.js:795` (map-gen `markLandmassRegionId`) and `hex-map.js:357` (age-transition serialization restore). No `WorldBuilder.MapPlots` landmass/continent setter exists.
- **[VERIFIED]** "Hemisphere" is a coarser X-column-only split — `natural-wonder-generator.js:59`: `if (GameplayMap.getHemisphere(iX) != GameplayMap.getPrimaryHemisphere()) {`. Home/distant region assignment is driven by the Age flag — `assign-starting-plots.js:230` `GameInfo.Ages.lookup(Game.age).HumanPlayersPrimaryHemisphere`.
- **[INFERRED]** Whether `isDistantLands` derives its answer from `getLandmassRegionId` vs the player's home region, or from `getHemisphere(X)` vs `getPrimaryHemisphere()`, is **undetermined from source** — the two theories conflict and the function is native with no on-disk body. This ambiguity is decisive for Rung E.

### T4 — Placement validation & override args

`CREATE_ELEMENT` is a native engine operation; its validation is not in moddable data, and no caller anywhere passes a force/override/ignore argument.

- **[VERIFIED]** Base-game unit spawn arg set is `{Kind, Type, Location, Owner, IndependentIndex}` — `tuner-input.js:16-31`; city-child kinds add only `Parent`/`Progress` (`:218-249`); the unit-flag stress test uses `{Kind,Type,Location,Owner}` (`unit-flag-manager.js:356-363`). No override key in any of them.
- **[VERIFIED]** `CREATE_ELEMENT`/`DESTROY_ELEMENT` appear in **no** base `*.xml`/`*.sql` (`grep -rEn 'CREATE_ELEMENT|CreateElement|DESTROY_ELEMENT'` → zero matches), confirming validation lives entirely in engine C++.
- **[VERIFIED]** `Game.PlacementRules` is referenced exactly once — `age-transition-post-load.js:548` `Game.PlacementRules.getValidOceanNavalLocation(iPlayer)`; it returns a valid plot index (or -1) and the code steers a fleet to a legal tile (`:549-553`) rather than forcing an illegal one. No `canPlaceUnit`/`PlacementResult`/`PlacementError`/`GetUnitPlacement` symbol exists anywhere.
- **[VERIFIED]** Operation results surface only as a generic `{Success, FailureReasons[]}` shape — `core/ui/components/fxs-activatable.js:217-221` — with no distant-lands-specific code. **[CORRECTED — audit]** (No `RequiresDistantLands` column or distant-specific result enum exists anywhere on disk — grepped the whole tree, zero matches. The failure is a silent 0-unit seat, not a coded rejection.)
- **[INFERRED]** Because validation is native, whether `CREATE_ELEMENT` silently ignores an added unknown key (e.g. `Force:true`) or honors an undocumented override cannot be read from disk — needs a live probe.

### T5 — What gates `UNITOPERATION_TELEPORT_TO`

Teleport is gated by a **static `Units.Teleport` BOOLEAN column**, not by a `RequiresAbility` unit-ability, and no runtime effect flips that column.

- **[VERIFIED]** `unit-operations.xml:113` `<Row OperationType="UNITOPERATION_TELEPORT_TO" VisibleInUI="false" ...>` carries **no** `RequiresAbility` attribute, unlike siblings that do — confirmed this session at lines 86 (`AERIAL_RECON`), 90 (`CARGO_DROP`), 101 (`ATTACH_TIMED_ABILITY_SELF`), 114 (`UNIT_AIR_DROP RequiresAbility="true"`).
- **[VERIFIED]** The gate is the `Units.Teleport` boolean column, proven to exist and be data-settable by the rows that set it — `UNIT_JOHN_MAYNARD_KEYNES` carries `Teleport="true" AllowTeleportToOtherPlayerCapitals="true"` (`age-modern/data/units.xml:281`), and `UNIT_FOUNDER` carries `Teleport="false"` (`base-standard/data/units.xml:90`). **[CORRECTED — audit]** The gameplay-DB SQL schema is compiled into the binary: there is NO `01_GameplaySchema.sql` (or any gameplay `*.sql`) on disk — only `core/config/config-schema.sql` — so the raw column declaration cannot be quoted; the column's existence is established from the data rows above, not a schema file.
- **[VERIFIED]** `UNIT_JOHN_MAYNARD_KEYNES` sets `Teleport="true" AllowTeleportToOtherPlayerCapitals="true"` directly on its Units row (`age-modern/data/units.xml:281`); `UNIT_FOUNDER`'s row (`base-standard/data/units.xml:90`) has no `Teleport` attribute → defaults 0 → matches the live `canStart=false` for the founder.
- **[VERIFIED]** The only teleport EFFECT in base data is `EFFECT_TELEPORT_UNIT` (Bermuda Triangle, `racetowonders-terrain-gameeffects.xml:29`), which relocates to a `TerrainType` (`:40` `TERRAIN_OCEAN`), not an arbitrary tile. No `ADJUST_TELEPORT`/column-adjust effect exists (`grep -rin 'ADJUST_TELEPORT|EFFECT.*TELEPORT'` → only the Bermuda line).
- **[INFERRED]** The only grant lever on disk is a **load-time data edit** (`UPDATE Units SET Teleport=1` for the whole UnitType). Because gating is a column and not `RequiresAbility`, attaching a synthetic `UnitAbility(OperationType=UNITOPERATION_TELEPORT_TO)` via `EFFECT_UNIT_ADJUST_ABILITY` likely would **not** open the op — but that logic is C++ and unverifiable. Even with `Teleport=1`, whether `TELEPORT_TO`'s destination validator refuses distant tiles is unknown from source.

### T6 — Ocean-age gate & modifier reachability

Ocean-crossing is a **tech unlock implemented as unit-level modifiers** and is fully modifier-reachable; "distant lands" itself is an **Age property**, not a modifier target, and no effect toggles it.

- **[VERIFIED]** Ocean travel = a bundle of `COLLECTION_PLAYER_UNITS` effects: `EFFECT_ADJUST_UNIT_VALID_TERRAIN` (TERRAIN_OCEAN valid) + `EFFECT_UNIT_ADJUST_EMBARKATION_TYPE` (`UNIT_EMBARKATION_DEEP_WATER`) — `age-exploration/data/progression-trees-tech-gameeffects.xml:49-62` and `:12-41` (plus `IGNORE_MOVEMENT_OBSTACLE` Obstacle=TERRAIN_OCEAN and `WATER_DAMAGE_PROTECTION`).
- **[VERIFIED]** Attached to Exploration tech nodes — `progression-trees-tech.xml:57-136` (`NODE_TECH_EX_CARTOGRAPHY` → `MOD_OCEAN_COMMAND`; `NODE_TECH_EX_SHIPBUILDING` → `MOD_TECH_EX_NO_OCEAN_OBSTACLE`, `MOD_TECH_OCEAN_TRAVEL_EMBARKED`) and reused in Modern (`age-modern/data/civilizations-common-gameeffects.xml:132-147`), proving any modifier can grant it.
- **[VERIFIED]** "Distant lands" is an **Age-level** property — `ages.xml:12-14`: `AGE_ANTIQUITY ... HumanPlayersPrimaryHemisphere="true" NoVictoriesSecondaryHemisphere="true"`; Exploration keeps primary-hemisphere start; Modern has neither.
- **[VERIFIED]** A player Bool `AllowEmbarkation` exists (`player-properties.xml:7`) but no EFFECT writes it (engine-managed). The only distant-lands data hooks are read-only requirements (`REQUIREMENT_CITY_IS_DISTANT_LANDS`, `REQUIREMENT_TRADE_ROUTE_IS_DISTANT_LANDS`) — no `ALLOW/IGNORE/SETTLE_DISTANT_LANDS` effect.
- **[INFERRED]** Ocean-travel capability and the placement gate are independent: granting deep-water embarkation lets a unit *physically move* across ocean but is not shown to alter the native `isDistantLands` placement refusal.

### T7 — WorldBuilder surface

There is **no** continent/hemisphere/landmass **setter** on the runtime `WorldBuilder.MapPlots` surface anywhere in shipped code.

- **[VERIFIED]** Exactly six `WorldBuilder.MapPlots` setters are ever called, all in `tuner-input.js`: `setTerrain, setFeature, setResource, setFertility, setOwnership, setBiome` (lines 48-206; `.js.map` source names confirm the same six, no others).
- **[VERIFIED]** No `setContinent`/`setHemisphere`/`setPlotContinent` in any real JS (`rg 'setContinent|setHemisphere|setPlotContinent' -g '*.js' -g '!*.map'` → no output). `ContinentType` is only a **save-format serialization column** (`schema-worldbuilder-map.sql:64-73`, alongside `LandmassRegionId INTEGER`).
- **[VERIFIED]** Continent assignment at runtime is bulk `TerrainBuilder.stampContinents()` (`common-generation.js:39`), map-gen only — not a per-plot repaint.
- **[VERIFIED]** The hemisphere test is X-column-only (`natural-wonder-generator.js:59`), so a continent repaint could not, on its own, move a tile across a column-based distant boundary — **if** the gate is column-based (see T3 ambiguity).
- **[INFERRED]** The live `MapPlots` enumeration this session (setTerrain/Feature/Fertility/Resource/Revealed/AllRevealed/Ownership/Biome) contained no landmass setter; `TerrainBuilder` is a **distinct object** not enumerated live, so its runtime/isolate callability is untested.

### T8 — Alternate placement paths

Every alternate landing path either enforces the same rules or runs in a different execution context than the cheat-panel UI isolate.

- **[VERIFIED]** `UNITOPERATION_MOVE_TO` is a real UI move op issued with only `{X,Y}` (`interface-mode-move-to.js:94-98`) and routed through `canStart` → `Game.UnitOperations.sendRequest` (`world-input.js:502-511`) — it obeys pathing/embark, not a bypass.
- **[VERIFIED]** `UNITOPERATION_TELEPORT_TO_CITY` restricts destinations to the engine-computed `result.Plots` (the player's settlements) — `interface-mode-teleport-to-city.js:11-14,47`.
- **[VERIFIED]** `UNITOPERATION_TELEPORT_TO` (arbitrary tile) is `VisibleInUI="false"` (`unit-operations.xml:113`) and has **zero JS callers**; the mod confirmed in-game that an isolate `sendRequest` for it is silently dropped (`api.js:224-229`).
- **[VERIFIED]** The engine's own legal placement APIs — `Units.create(playerId,{Type,Location,Validate:true})` (`age-transition-post-load.js:608`), `Units.setLocation(unitId,location)` (`:483,:553`), `player.AdvancedStart.createDefender(...)` (`:434-437`) — appear **only** in the GameCore simulation script, and the mod notes they are "gameplay-SCRIPT only and inert from this isolate" (`api.js:238-240`).
- **[VERIFIED]** `Units.create` exposes an optional `Validate` flag (omitted at `:468`, `true` at `:608`), implying validation is switchable.
- **[VERIFIED]** Modifier-driven spawns take their plot from the modifier's collection context, not an arbitrary X/Y — `EFFECT_PLAYER_GRANT_UNIT_AT_PLOT` args are only `Amount/UnitType/AllowUniqueOverride` (`discovery-stories-gameeffects.xml:1165-1168`).

---

## Candidate bypass ladder

| Rung | Title | Classification | Key evidence (file:line) |
|------|-------|----------------|--------------------------|
| A | Direct `CREATE_ELEMENT` on distant tile (baseline) | **code-refuted** (established live) | `api.js:261-267`; native gate, session ground truth |
| B | Independent/barbarian-owner `CREATE_ELEMENT` on distant land | **needs-live-test** | `tuner-input.js:24-31`; `.js.map` "create units for other players"; `api.js:266-267` |
| C | Grant `Teleport` tag/ability to unlock `TELEPORT_TO` | **needs-live-test** | `unit-operations.xml:113`; `age-modern/units.xml:281` (JMK `Teleport=true`) |
| D | Flip player "can enter distant lands" via modifier | **code-refuted** | `modifiers.xml` (no DISTANT/EMBARK/HEMISPHERE/LANDMASS type); `player-properties.xml:7`; `ages.xml:12` |
| E | WorldBuilder/TerrainBuilder region repaint → place → restore | **needs-live-test** | `map-utilities.js:795`; `hex-map.js:357`; `natural-wonder-generator.js:59` (unresolved T3 ambiguity) |
| F | Alternate placement op (`Units.create Validate:false`, `setLocation`) | **needs-live-test** | `age-transition-post-load.js:468,608`; `api.js:238-240` |
| G | Two-hop via embark/transport (legal traversal) | **needs-live-test** | `unit-operations.xml:135-136` (EMBARK auto); `world-input.js:502-511`; T6 ocean modifiers |

**Rung A (baseline, refuted):** The mod's current path. `CREATE_ELEMENT` with the local major owner silently seats 0 units when `Players.get(owner).isDistantLands({x,y})===true` — established live this session and pre-checked in the mod at `api.js:267`. This is the wall the other rungs try to get around.

**Rung B (needs-live-test):** The base tuner deliberately builds `CREATE_ELEMENT` with `args.Owner = selectedPlayer` (a *different* player) and an `IndependentIndex`, then submits under `localPlayerID` — the `.js.map` comment reads "let them create units for other players" (`tuner-input.js:24-31`). Since the distant refusal is keyed on the **owner** (`api.js:266-267`), changing the owner to an independent/barbarian changes *whose* home hemisphere the gate consults. Whether `isDistantLands` returns true, false, or undefined for a non-major owner is **not on disk** (no JS call site ever passes an independent owner; the function is native). Not refuted, not supported — only the game settles it.

**Rung C (needs-live-test):** Teleport is gated by the static `Units.Teleport` column, not an ability (`unit-operations.xml:113` has no `RequiresAbility`; `:114` shows a sibling that does). The one grant lever on disk is a load-time `UPDATE Units SET Teleport=1` for the whole UnitType (JMK proves the column works — `age-modern/units.xml:281`). But even granted, whether `TELEPORT_TO`'s native destination validator accepts a distant tile is unknown, and the isolate `sendRequest` route for `TELEPORT_TO` is already confirmed dead (`api.js:224-229`). A live `canStart(UNITOPERATION_TELEPORT_TO, distantTile)` on a teleport-tagged unit is required.

**Rung D (code-refuted):** The rung presumes a togglable player "can enter distant lands" flag. None exists: `modifiers.xml` has no DISTANT/EMBARK/HEMISPHERE/LANDMASS modifier type; the only HEMISPHERE effect is `EFFECT_ENABLE_RELIGION_AUTO_SPREAD_FOREIGN_HEMISPHERE` (unrelated); `player-properties.xml:7` has no distant/hemisphere/landmass property (nearest is engine-managed `AllowEmbarkation`); and the home-hemisphere assignment is an Age property (`ages.xml:12`) fixed at map-gen. There is no property or effect to bind a modifier to — refuted, not merely untested. *(Caveat [INFERRED]: EFFECT strings are engine-defined; disk cannot absolutely prove no undocumented engine effect exists, but none is referenced anywhere on disk.)*

**Rung E (needs-live-test):** The literal "WorldBuilder continent setter" sub-path is refuted (T7: only six MapPlots setters, no continent setter). But the rung's real mechanism — repaint the persisted `LandmassRegionId`, place, restore — has a concrete writer: `TerrainBuilder.setLandmassRegionId(x,y,id)` (`map-utilities.js:795`, `hex-map.js:357`). Two facts keep this open: (1) `TerrainBuilder` was **not** in the live `MapPlots` enumeration, so isolate callability at normal runtime is untested; (2) the **T3 ambiguity** — if `isDistantLands` reads `LandmassRegionId` (T3 theory), repainting to the home region before `CREATE_ELEMENT` could open placement; if it reads `getHemisphere(X)` (T7 theory), it cannot. That premise is unverified, so it cannot carry either a refutation or a green light.

**Rung F (needs-live-test):** `Units.create` with `Validate:false` and identity-preserving `Units.setLocation` are the only non-`CREATE_ELEMENT` native seating APIs, and the `Validate` flag implies validation is skippable (`age-transition-post-load.js:608` vs `:468`). But they appear only in the GameCore simulation VM, and the mod's own notes call them "inert from this isolate" (`api.js:238-240`). Both empirical unknowns — isolate reachability and whether `Validate:false` skips the distant gate — require a live probe. This is the most mechanically promising lead *if* the isolate can reach them.

**Rung G (needs-live-test):** Hop 1 (place on a home tile) works. Hop 2 is legal ocean traversal: there is no cargo/carrier mechanic (`rg 'loadCargo|loadUnit|cargo|carrier'` → nothing), so "transport" reduces to EMBARK, which is an engine-auto op folded into `MOVE_TO` (`unit-operations.xml:135-136`). Ocean capability is modifier-grantable (T6). Whether `MOVE_TO`'s native `canStart` permits a destination on a distant-lands tile — and whether the isolate can drive `MOVE_TO` to completion (a prior fallback "never moved" per `api.js:224-228`) — is unresolved. This is the game's *intended* legal path, not an instant bypass.

---

## Four-walls verdict

The task defines four independent walls. Cross-continent land-unit teleport in Antiquity is IMPOSSIBLE only if **all four** stand.

**Wall 1 — JS placement API rejects with a distant-specific code AND exposes no override arg.**
**Status: PARTIALLY STANDING (override-arg half UNTESTED).** The "no override arg" half stands on disk: every `CREATE_ELEMENT` caller uses only `{Kind,Type,Location,Owner,IndependentIndex(/Parent/Progress)}` with no force/ignore key (**[VERIFIED]** `tuner-input.js:16-31,218-249`; `unit-flag-manager.js:356-363`), and the op is native (not in any XML/SQL — **[VERIFIED]** grep zero matches). The "distant-specific rejection code" half is actually *weaker* than a wall: the failure is a **silent 0-unit seat**, not a coded rejection (**[VERIFIED]** `api.js:261-262`), and results only ever surface as generic `{Success, FailureReasons[]}` (**[VERIFIED]** `fxs-activatable.js:217-221`). Whether the native op silently ignores an *added* unknown key vs honors an undocumented override is UNTESTED. **Live-test question:** *Does `CREATE_ELEMENT` with an extra `{Force:true}` (or `IgnorePlacement:true`) key seat a unit on a tile where `isDistantLands` is true?*

**Wall 2 — No JS per-tile hemisphere/continent setter that survives placement.**
**Status: STANDING on the enumerated surface; BREACH CANDIDATE untested.** No `WorldBuilder.MapPlots` continent/hemisphere/landmass setter exists in shipped JS — only six setters, none of them landmass (**[VERIFIED]** `tuner-input.js:48-206` + `.js.map`; `rg setContinent|setHemisphere` → no output). **However**, `TerrainBuilder.setLandmassRegionId(x,y,id)` **is** a real per-plot region writer (**[VERIFIED]** `map-utilities.js:795`, `hex-map.js:357`) on an object that was **not** live-enumerated. So the wall stands for `WorldBuilder.MapPlots` but is UNTESTED for `TerrainBuilder` at runtime, and "survives placement" additionally depends on the unresolved T3 gate-derivation. **Live-test question:** *Is `TerrainBuilder.setLandmassRegionId` callable from the panel isolate at normal runtime, and does mutating a distant tile's region to the home region flip `isDistantLands` to false and allow `CREATE_ELEMENT`?*

**Wall 3 — `TELEPORT_TO` gated by an engine enum/tag with NO data-grant path.**
**Status: BREACHED (a data-grant path exists) but efficacy UNTESTED.** The gate is the static `Units.Teleport` boolean column (**[VERIFIED]** via data rows — JMK `age-modern/data/units.xml:281`; the gameplay SQL schema is binary-compiled, not on disk), and it **is** grantable via a load-time data edit — `UNIT_JOHN_MAYNARD_KEYNES` carries `Teleport="true"` on its Units row (**[VERIFIED]** `age-modern/units.xml:281`). So "NO data-grant path" is false: `UPDATE Units SET Teleport=1` for `UNIT_FOUNDER` is a real path (whole-UnitType, load-time). What remains UNTESTED is whether a granted unit's `TELEPORT_TO` destination validator then accepts a distant tile, and whether any non-isolate invocation route exists (the isolate `sendRequest` route is dead — **[VERIFIED]** `api.js:224-229`). **Live-test question:** *After granting `Teleport=1`, does `Game.UnitOperations.canStart(unit, "UNITOPERATION_TELEPORT_TO", {X,Y})` return `Success:true` for a distant-lands destination?*

**Wall 4 — No modifier-reachable player-level "ignore distant lands" property.**
**Status: STANDING.** No such player property or effect exists in the entire moddable vocabulary: `modifiers.xml` has no DISTANT/EMBARK/HEMISPHERE/LANDMASS modifier type (**[VERIFIED]** grep → no output); `player-properties.xml` has no distant/hemisphere/landmass property (**[VERIFIED]** `:7`, only engine-managed `AllowEmbarkation`); all distant-lands data hooks are read-only requirements/scopes (**[VERIFIED]** T6); and the assignment is a fixed Age property (**[VERIFIED]** `ages.xml:12`). *(Caveat [INFERRED]: cannot prove absence of an undocumented engine effect, but none is referenced on disk.)*

**Bottom line: NOT-IMPOSSIBLE (on current evidence).** Only Wall 4 stands cleanly. Wall 3 is already **breached** by a load-time `Units.Teleport` data grant (efficacy against the distant gate still to be confirmed). Walls 1 and 2 have concrete, un-refuted breach candidates that source cannot close (unknown-key override on `CREATE_ELEMENT`; `TerrainBuilder.setLandmassRegionId` region-repaint). The single cleanest *named* candidate path is **Rung F / Wall-1 override family**: `Units.create(..., Validate:false)` or an override key, pending a live probe of isolate reachability and gate-skip. Because two of four walls are open and one is breached, the claim "cross-continent land-unit teleport in Antiquity is impossible" is **not supported by the source evidence** — it is unproven pending the live probes below.

---

## Recommendation

There is **no fully code-supported route** — every non-refuted rung turns on native C++ behavior that cannot be read from disk. The most promising *code-supported* lead is the **`Units.Teleport` load-time data grant (Rung C / Wall 3)**: it is the only breach that is concretely proven on disk (`age-modern/units.xml:281` demonstrates the column works). Pair it with `AllowTeleportToOtherPlayerCapitals=1` so that, if the player owns a settlement on the far continent, `TELEPORT_TO_CITY` becomes a candidate destination path.

However, that grant's *efficacy against the distant gate* is unverified, so do not ship it blind. The ordered priority is:

1. **Probe F first** (`Units.create Validate:false` from the isolate) — if the isolate can reach it and `Validate:false` skips the gate, this is a single-call solution with no data edit.
2. **Probe E** (`TerrainBuilder.setLandmassRegionId` repaint→place→restore) — resolves the T3/T7 ambiguity as a side effect and, if the gate is region-derived, yields a self-contained bypass.
3. **Probe B** (independent-owner `CREATE_ELEMENT`) — cheapest to try, uses an already-supported payload shape.
4. **Probe C** (grant `Teleport`, then `canStart`) — requires a mod data edit, so validate via probe before committing.

Do **not** pursue Rung D (refuted: no property/effect to bind).

---

## Live-probe queue (Phase 2)

Run these once the game is loaded (Antiquity, a save with a reachable distant-lands landmass). Each probe self-selects a distant tile via `isDistantLands`. **Do not run any of these during discovery** — they are for the live phase only.

1. **Wall-1 override key (Rung A+):**
   `python3 tools/tuner_probe.py '(()=>{const o=GameContext.localPlayerID,p=Players.get(o),W=GameplayMap.getGridWidth(),H=GameplayMap.getGridHeight();let t=null;for(let y=0;y<H&&!t;y++)for(let x=0;x<W;x++){if(!GameplayMap.isWater(x,y)&&p.isDistantLands({x,y})){t={x,y};break;}}if(!t)return"NO_DISTANT_TILE";const before=Array.from(MapUnits.getUnits(t.x,t.y)).length;Game.PlayerOperations.sendRequest(o,"CREATE_ELEMENT",{Kind:"UNIT",Type:Database.makeHash("UNIT_SCOUT"),Location:t,Owner:o,IndependentIndex:-1,Force:true,IgnorePlacement:true});const after=Array.from(MapUnits.getUnits(t.x,t.y)).length;return JSON.stringify({tile:t,distant:p.isDistantLands(t),before,after,placed:after>before});})()'`
   **Pass:** `after > before` (unit seated) with an unknown-key payload → Wall 1 breached.

2. **Rung B — independent/barbarian owner:**
   `python3 tools/tuner_probe.py '(()=>{const lp=GameContext.localPlayerID,LP=Players.get(lp),W=GameplayMap.getGridWidth(),H=GameplayMap.getGridHeight();let t=null;for(let y=0;y<H&&!t;y++)for(let x=0;x<W;x++){if(!GameplayMap.isWater(x,y)&&LP.isDistantLands({x,y})){t={x,y};break;}}if(!t)return"NO_DISTANT_TILE";const inds=(Players.getAlive?Players.getAlive():[]).filter(p=>p&&p.isIndependent);if(!inds.length)return"NO_INDEPENDENT";const owner=inds[0].id,before=Array.from(MapUnits.getUnits(t.x,t.y)).length;Game.PlayerOperations.sendRequest(lp,"CREATE_ELEMENT",{Kind:"UNIT",Type:Database.makeHash("UNIT_SCOUT"),Location:t,Owner:owner,IndependentIndex:-1});const after=Array.from(MapUnits.getUnits(t.x,t.y)).length;return JSON.stringify({tile:t,owner,indIsDL:(typeof inds[0].isDistantLands==="function")?inds[0].isDistantLands(t):"no-fn",before,after,placed:after>before});})()'`
   **Pass:** `after > before` for an independent owner → owner-swap breaches the gate.

3. **Rung C — grant Teleport then canStart:** *(requires the mod to have applied `UPDATE Units SET Teleport=1` for the test unit at load; JMK is a ready-made teleport-tagged control)*
   `python3 tools/tuner_probe.py '(()=>{const p=GameContext.localPlayerID,pl=Players.get(p),W=GameplayMap.getGridWidth(),H=GameplayMap.getGridHeight();let home=null,dist=null;for(let y=0;y<H;y++){for(let x=0;x<W;x++){if(GameplayMap.isWater(x,y))continue;const d=pl.isDistantLands({x,y});if(!d&&!home)home={x,y};if(d&&!dist)dist={x,y};}if(home&&dist)break;}const ty=Database.makeHash("UNIT_JOHN_MAYNARD_KEYNES");Game.PlayerOperations.sendRequest(p,"CREATE_ELEMENT",{Kind:"UNIT",Type:ty,Location:home,Owner:p,IndependentIndex:-1});const ids=pl.Units.getUnitIds().map(i=>Units.get(i)).filter(u=>u&&u.type===ty),u=ids[ids.length-1];const res=u?Game.UnitOperations.canStart(u.id,"UNITOPERATION_TELEPORT_TO",{X:dist.x,Y:dist.y},false):null;return JSON.stringify({home,dist,spawned:!!u,canStartTeleportToDistant:res});})()'`
   **Pass:** `canStartTeleportToDistant.Success === true` for the distant destination → teleport op accepts distant tiles once tagged.

4. **Rung E — region repaint → place → restore (also resolves the T3/T7 gate-derivation ambiguity):**
   `python3 tools/tuner_probe.py '(()=>{const o=GameContext.localPlayerID,p=Players.get(o),W=GameplayMap.getGridWidth(),H=GameplayMap.getGridHeight();let t=null;for(let y=0;y<H&&!t;y++)for(let x=0;x<W;x++){if(p.isDistantLands({x,y})&&!GameplayMap.isWater(x,y)){t={x,y};break;}}if(!t)return"NO_DISTANT_TILE";const ph=GameplayMap.getPrimaryHemisphere(),before=p.isDistantLands(t),reg0=GameplayMap.getLandmassRegionId(t.x,t.y),hemi=GameplayMap.getHemisphere(t.x);let setRes="n/a";try{TerrainBuilder.setLandmassRegionId(t.x,t.y,ph);setRes="ok";}catch(e){setRes="ERR:"+e;}const reg1=GameplayMap.getLandmassRegionId(t.x,t.y),after=p.isDistantLands(t);Game.PlayerOperations.sendRequest(o,"CREATE_ELEMENT",{Kind:"UNIT",Type:Database.makeHash("UNIT_SCOUT"),Location:t,Owner:o,IndependentIndex:-1});let n=0;try{n=Array.from(MapUnits.getUnits(t.x,t.y)).length;}catch(e){n="ERR:"+e;}try{TerrainBuilder.setLandmassRegionId(t.x,t.y,reg0);}catch(e){}return JSON.stringify({tile:t,primaryHemisphere:ph,tileHemisphere:hemi,isDistantBefore:before,isDistantAfter:after,landmassBefore:reg0,landmassAfter:reg1,setLandmassResult:setRes,unitsAfterPlace:n});})()'`
   **Pass:** `setLandmassResult:"ok"` AND `isDistantAfter === false` AND `unitsAfterPlace > 0` → gate is region-derived and repaint breaches Wall 2. (If `isDistantAfter` stays true after a successful region change, the gate is hemisphere/column-based — T7 confirmed.)

5. **Rung F — alternate placement op (`Units.create`), the top recommendation:**
   `python3 tools/tuner_probe.py '(()=>{const o=GameContext.localPlayerID,p=Players.get(o),W=GameplayMap.getGridWidth(),H=GameplayMap.getGridHeight();let t=null;for(let y=0;y<H&&!t;y++)for(let x=0;x<W;x++){if(p.isDistantLands({x,y})&&!GameplayMap.isWater(x,y)&&!GameplayMap.isImpassable(x,y)){t={x,y};break;}}if(!t)return"NO_DISTANT_TILE";const ty=Database.makeHash("UNIT_SCOUT"),before=Array.from(MapUnits.getUnits(t.x,t.y)).length;let rV,rN;try{rV=Units.create(o,{Type:ty,Location:t,Validate:false});}catch(e){rV="THROW:"+e;}try{rN=Units.create(o,{Type:ty,Location:t});}catch(e){rN="THROW:"+e;}const after=Array.from(MapUnits.getUnits(t.x,t.y)).length;return JSON.stringify({tile:t,distant:p.isDistantLands(t),before,after,createValidateFalse:rV,createNoValidate:rN});})()'`
   **Pass:** no THROW AND `after > before` (especially with `Validate:false`) → the isolate can drive `Units.create` and bypass the gate.

6. **Rung G — MOVE_TO reachability onto distant land (naval-traversal / legal path):**
   `python3 tools/tuner_probe.py '(()=>{try{const o=GameContext.localPlayerID,p=Players.get(o);let u=null;for(const id of (p.Units&&p.Units.getUnitIds?p.Units.getUnitIds():[])){const c=Units.get(id);if(c&&c.location){u=c;break;}}if(!u)return"NO_UNIT";const W=GameplayMap.getGridWidth(),H=GameplayMap.getGridHeight();let dl=null;for(let y=0;y<H&&!dl;y++)for(let x=0;x<W;x++){if(p.isDistantLands({x,y})){dl={x,y};break;}}if(!dl)return"NO_DISTANT_TILE";const r=Game.UnitOperations.canStart(u.id,"UNITOPERATION_MOVE_TO",{X:dl.x,Y:dl.y},false);return JSON.stringify({unitLoc:u.location,distantTile:dl,moveSuccess:r&&r.Success,failureReasons:r&&r.FailureReasons,validPlots:(r&&r.Plots)?r.Plots.length:null});}catch(e){return"THROW:"+String(e&&e.message||e);}})()'`
   **Pass:** `moveSuccess === true` (or the distant tile appears in `r.Plots`) → the movement validator permits a distant destination, confirming the legal two-hop path.

7. **Naval-unit-on-distant-water test (is the gate land-specific or universal?):**
   `python3 tools/tuner_probe.py '(()=>{const o=GameContext.localPlayerID,p=Players.get(o),W=GameplayMap.getGridWidth(),H=GameplayMap.getGridHeight();let t=null;for(let y=0;y<H&&!t;y++)for(let x=0;x<W;x++){if(GameplayMap.isWater(x,y)&&p.isDistantLands({x,y})){t={x,y};break;}}if(!t)return"NO_DISTANT_WATER";const ty=Database.makeHash("UNIT_GALLEY"),before=Array.from(MapUnits.getUnits(t.x,t.y)).length;Game.PlayerOperations.sendRequest(o,"CREATE_ELEMENT",{Kind:"UNIT",Type:ty,Location:t,Owner:o,IndependentIndex:-1});const after=Array.from(MapUnits.getUnits(t.x,t.y)).length;return JSON.stringify({tile:t,distant:p.isDistantLands(t),before,after,placed:after>before});})()'`
   **Pass:** `after > before` → the distant gate does **not** block naval units on distant *water*, proving the refusal is land/placement-specific and narrowing where the bypass must act. (**Fail** = 0-unit seat → the gate is universal across domains.)

Report each probe's raw JSON. A "pass" on any of probes 1, 2, 4, or 5 constitutes a code-confirmed breach of the corresponding wall and should be re-run 2-3 times (different tiles) before being treated as reliable, given the 1.4.1-vs-1.4.0 version drift.
---

## ★ Addendum (orchestrator, 2026-07-14) — the ACTUAL reason units can't leave the home continent

Phase-1's T6 concluded Wall 4 stands because no modifier flips a *"distant lands allowed"* property. That
is still literally true, but it **missed the real mechanism**, found by direct grep afterwards. Distant
lands are unreachable in Antiquity not because of a distant-lands flag, but because of **embarkation tier**:

- **[VERIFIED]** Embarkation tiers are data rows, and each maps to the terrain it may enter —
  `base-standard/data/unit-movement.xml`: `<Row EmbarkationType="UNIT_EMBARKATION_DEEP_WATER" TerrainType="TERRAIN_OCEAN"/>`
  (SHALLOW_WATER maps only to `TERRAIN_COAST` + `TERRAIN_NAVIGABLE_RIVER`; INLAND_WATER only to river).
- **[VERIFIED]** Antiquity's Sailing tech grants only the **shallow** tier —
  `age-antiquity/data/progression-trees-tech-gameeffects.xml:36`:
  `<Modifier id="MOD_SAILING_EMBARKATION" collection="COLLECTION_PLAYER_UNITS" effect="EFFECT_UNIT_ADJUST_EMBARKATION_TYPE" permanent="true">` … `<Argument name="EmbarkationType">UNIT_EMBARKATION_SHALLOW_WATER</Argument>`
- **[VERIFIED]** The **deep** tier (the one that opens `TERRAIN_OCEAN`) is granted in the Modern age —
  `age-modern/data/civilizations-common-gameeffects.xml:141`:
  `<Modifier id="MOD_MODERN_EMBARKATION" collection="COLLECTION_PLAYER_UNITS" effect="EFFECT_UNIT_ADJUST_EMBARKATION_TYPE" permanent="true">` with
  `<SubjectRequirements><Requirement type="REQUIREMENT_UNIT_DOMAIN_MATCHES"><Argument name="UnitDomain">DOMAIN_LAND</Argument></Requirement></SubjectRequirements>` and
  `<Argument name="EmbarkationType">UNIT_EMBARKATION_DEEP_WATER</Argument>`
- **[VERIFIED]** A companion effect marks a terrain valid per unit-class —
  `age-modern/.../civilizations-common-gameeffects.xml:133` `MOD_MODERN_OCEAN_TRAVEL`,
  `effect="EFFECT_ADJUST_UNIT_VALID_TERRAIN"`, `<Argument name="TerrainType">TERRAIN_OCEAN</Argument><Argument name="Valid">true</Argument>`.
- **[VERIFIED]** The full moddable effect vocabulary here is exactly three:
  `EFFECT_UNIT_ADJUST_EMBARKATION_TYPE`, `EFFECT_ADJUST_UNIT_VALID_TERRAIN`, `EFFECT_ADJUST_UNIT_EMBARKED_MOVEMENT`.

**Consequence — Wall 4 restated.** There is no modifier that says "ignore distant lands" (Wall 4 stands as
written), **but** there IS a fully modifier-reachable capability that produces the same end result by the
game's own intended route: grant `UNIT_EMBARKATION_DEEP_WATER` to `DOMAIN_LAND` units in Antiquity and the
ocean becomes traversable, making the far continent reachable. This is a **movement** unlock, NOT a
`CREATE_ELEMENT` placement unlock — the two are separate checks, and whether embarkation also relaxes the
placement gate is **UNTESTED** (new highest-value live probe).

**Caveat [VERIFIED — engine rule]:** modifiers are serialized into saves, so a newly-added modifier only
takes effect in a **NEW game**; it will not retrofit the user's current save.

**New live probes (prepend to the Phase-2 queue):**
- **P0a** — after granting deep-water embarkation, does `CREATE_ELEMENT` seat a unit on a distant-lands tile?
- **P0b** — is embarkation settable at RUNTIME (without a new game)? Probe for a unit/player embarkation
  setter or a runtime modifier-attach API; if one exists, the whole feature becomes save-compatible.
