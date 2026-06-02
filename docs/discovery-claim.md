# Discovery — City Claim → Growth/Build (Item 1, Phase 1.A)

_Investigation only. Findings from a 9-agent sweep of the unpacked base game
(`…\Sid Meier's Civilization VII\Base\modules\`, build 23245653 / Update 1.4.0), cross-checked by
3 adversarial verifiers. No code was changed._

## TL;DR

The current claim writes the **player border** but never makes the tile part of the **city's
territory**, and those are two separate stores in Civ 7. That is the whole bug.

- **Root cause (HIGH confidence):** `WorldBuilder.MapPlots.setOwnership(playerID, loc)` sets
  player-level plot ownership only. Growth, tile-working, and building placement all read a *different*
  per-city store (`city.getPurchasedPlots()` / `GameplayMap.getOwningCityFromXY` /
  `city.Growth.getGrowthDomain()`). A `setOwnership` tile joins the player's border but is in no city's
  territory → the city can't grow/work/build on it.
- **Candidate A — radius modification: NOT FEASIBLE** (confirmed by adversarial re-check).
- **Candidate B — per-tile city attach: FEASIBLE**, via the engine's own
  `city.Growth.claimPlot({x,y})`. One unknown remains (UI-isolate callability) that an in-game probe
  in Phase 1.B resolves immediately.
- **Recommendation:** Candidate B — replace the `setOwnership` call with `city.Growth.claimPlot(loc)`
  (with a documented fallback chain). See [Recommendation](#recommendation).

---

## ⚠ Phase 1.B — Round 1 result (2026-06-02): Candidate B's primary mechanisms FAILED

In-game probe data (routed to `UI.log` via the CSS-warning trick, since panel-isolate `console.log`
doesn't reach it). Across ~10 claims, the city's territory **never moved**:

| Signal | Every claim |
|---|---|
| `purchasedPlots` (city territory) | **37 → 37** (no change, ever) |
| `getGrowthDomain().length` (workable set) | **37 → 37** (no change, ever) |
| `getOwningCityFromXY` | unchanged (−1→−1 for unowned; a tile already owned by city `65536` stayed; a tile owned by another city `327684` stayed) |

Conclusions (HIGH confidence — empirical):
1. **`city.Growth.claimPlot` is INERT from the panel isolate** — the M3 `Units.create` trap, confirmed.
   It doesn't throw, but changes nothing. (The `rural=t` cases were tiles that already had a district
   from earlier `CREATE_ELEMENT` calls, not from `claimPlot`.)
2. **`CREATE_ELEMENT {Kind:"DISTRICT", DISTRICT_RURAL, Parent:cityID}` drops a *free-floating* rural
   district** (the visible fishing-boats improvement) **but does NOT attach the plot to the city**
   (`owningCity` stays −1, `purchasedPlots`/`growthDomain` unchanged). So the improvement yields do **not**
   go to the city — it's cosmetic.
3. **`setOwnership` only flips the player border** (as designed) — never city territory.

→ None of the three change the gate (`purchasedPlots` / `getGrowthDomain`). **Candidate B as specified
does not work.**

### Round 2 result (2026-06-02): `city.purchasePlot` GROWS the city's territory (async)

Probe data, 10 near-city claims (city `65536`, center ~x38,y29; all tiles x36–42,y29–33):

- **`purchasedPlots` climbed monotonically 37 → 45** — but the increment shows up on the *next* claim's
  `before`, not the current `after`. So **`purchasePlot` works, ASYNCHRONOUSLY** — its effect lands a
  frame after the call returns (like a deferred op). Re-claiming an already-owned tile (`owningCity`
  already `65536`) added nothing, as expected.
- **`growthDomain` stayed 37 → 37 throughout.** So `purchasePlot` adds the tile to the city's
  **territory/ownership** but **not** to its **workable/growable set**. → owned but not workable.
- Round-2 build had a bug: the synchronous "did it grow?" check couldn't see the async effect, so the
  `setOwnership` fallback fired on *every* claim, layering a player border on top of the city claim.
  That mixed player+city ownership is the likely cause of the in-game **"claimed tiles render separated
  from the merged city territory"** report.

In-game (user): adjacent claimed tiles now **visually join the city territory** (purchasePlot ✓), but
appear separated during natural growth (the mixed-state artifact), and **resource tiles get no
improvement and still can't be grown on** (the `growthDomain`/workability gap).

**Conclusions:** `purchasePlot` is the correct OWNERSHIP mechanism (replaces `setOwnership`). Two gaps
remain: (a) the separation artifact (fix: drop the `setOwnership` fallback — done in round 3), and
(b) **workability** — an owned tile has no rural district and isn't in the growth domain.

### Round 3 result + ⛔ CONCLUSION (2026-06-02): out-of-radius workability is an ENGINE WALL

Round 3 (`purchasePlot` alone) + the user's in-game test:
- **`purchasePlot` owns out-of-radius tiles** — `purchasedPlots` grew across claims, and the user
  confirms the out-of-max-radius tile "is showing as part of my territory." So ownership reaches beyond
  the work radius, and it attaches to the **city** (it's `getPurchasedPlots()`, a per-city set), not just
  the player border. ✓ (Removing the `setOwnership` fallback also removes the separated-rendering cause.)
- **`growthDomain` stayed 37 → 37 on every claim**, across both cities tested. The owned tile is never
  added to the workable/growable set.
- The user **built an adjacent urban neighborhood** to force urban contiguity to the claimed tile (the
  game's own mechanic) → the claimed tile was **still not buildable/workable**. "It's like there's only
  the colour of my civ that makes it part of my territory."

**CONCLUSION (HIGH confidence, exhaustive):** making an **out-of-radius** claimed tile workable/buildable
is **not achievable from the mod's UI isolate.** Workability is gated by the city's native, radius-bound
**growth domain** (`getGrowthDomain`), which: has no JS setter; is not widened by any modifier/effect
(Candidate A — confirmed dead); and is not affected by `purchasePlot` (ownership-only), `claimPlot`
(inert), `CREATE_ELEMENT` district (free-floating), or even in-game adjacent urban building. Five distinct
mechanisms + the player's own urban test all fail. This matches the risk flagged in the original
recommendation ("urban-on-exclave / disconnected territory likely not feasible").

**What IS achievable:** `city.purchasePlot(loc)` claims a tile into the city's **territory** (ownership /
civ-colored border) at distance — strictly better than the old `setOwnership` (which set only the player
border and rendered separated). Within the city's work radius an owned tile is usable as normal; beyond
it, it is owned-but-inert (territory color only; may still grant passive ownership effects like the
resource being yours / culture / score — unverified).

Per the Item-1 prompt ("if a test case can't work without disproportionate effort, document it and tell
me — don't silently skip"): **the out-of-radius *usable*-tile goal is blocked by a hard engine
constraint. Awaiting the user's scope decision** (see below).

---

## 1. The actual gate that blocks growth/build on claimed tiles

### 1a. Two decoupled ownership concepts

Civ 7 stores plot ownership at **two independent levels**:

| Level | Read via | Written by | Drives |
|---|---|---|---|
| **Player border** | `GameplayMap.getOwner(x,y) → playerID` | `WorldBuilder.MapPlots.setOwnership(playerID, loc)` | border color / political owner |
| **City territory** | `city.getPurchasedPlots() → number[]`, `GameplayMap.getOwningCityFromXY(x,y) → cityID`, `city.Growth.getGrowthDomain(excludeHidden) → number[]` | `EXPAND` command / `city.purchasePlot` / `city.Growth.claimPlot` | growth, tile-working, building/improvement placement |

They are genuinely distinct lookups — the same code reads both for one plot:

```
city-banner-manager.js:275  const playerID       = GameplayMap.getOwner(loc.x, loc.y);
city-banner-manager.js:278  const cityComponentID = GameplayMap.getOwningCityFromXY(loc.x, loc.y);
```

Every border/growth/worker/yield layer derives a city's tiles from `getPurchasedPlots()`, **not** from
`getOwner`:

```
city-borders-layer.js:92   const cityPlots = city.getPurchasedPlots();   // territory set
worker-yields-layer.js:82  plotsToCheck = city.Growth?.getGrowthDomain(excludeHidden);  // work domain
```

`setOwnership` takes a **player, never a city** — only two call sites exist in the whole game, both in
the tuner, both player-only:

```
tuner-input.js:96   WorldBuilder.MapPlots.setOwnership(g_TunerState.MapPanel.selectedPlayer, loc);
tuner-input.js:206  WorldBuilder.MapPlots.setOwnership(PlayerIds.NO_PLAYER, loc);   // clear
```

→ It cannot append the plot to any city's `getPurchasedPlots()` list, so no city treats it as
territory. **This fully explains the symptom** and is HIGH confidence.

### 1b. "Growing onto a tile" = giving it a rural district

Growth/working a tile is not an ownership flag — it physically places a `DISTRICT_RURAL` (plus an
auto-chosen improvement) on the plot:

```
districts.xml:14-18         DISTRICT_RURAL … DistrictClass="RURAL" AutoRemove="true" NatureYields="true" Workable
districts.xml:21-108        District_FreeConstructibles: FLAT→FARM, HILL→MINE, COAST→FISHING_BOAT (by terrain/feature/resource)
constructibles.xml:174-196  Constructible_ValidDistricts: IMPROVEMENT_FARM→DISTRICT_RURAL; BUILDING_*→DISTRICT_URBAN/CITY_CENTER
```

A plot with **no district** matches no placement validator. `setOwnership` creates no district, so even
ignoring the territory issue, the tile has nothing on it to work.

### 1c. The deciding logic is native (not source-quotable)

The candidate-plot sets for growth and building are produced entirely by native engine bindings; the UI
only renders what they return and does **zero** geometric/ownership validation of its own:

```
model-place-population.js:91   Game.CityCommands.canStart(id, CityCommandTypes.EXPAND, {}, false).Plots   // growth candidates
interface-mode-place-building.js:59  Game.CityOperations.canStart(cityID, CityOperationTypes.BUILD, args, false)  // build candidates
interface-mode-acquire-tile.js:295   if (this.validPlots.find(e => e == plotIndex) …) accept(); else reject();  // UI gate = membership in the engine list
```

A definition search for `canStart`/`getPurchasedPlots`/`getOwningCityFromXY` finds only `.js.map`
noise — they are compiled C++ bindings with no JS body.

> **Verifier correction:** an earlier discovery finding claimed an "adjacency-to-territory" gate in
> `interface-mode-acquire-tile.js:83-90`. That loop builds `validNeighborPlots`, which is consumed
> **only for overlay coloring** (`:241-242`), not as a growth/build gate. The real gate is
> **city-territory membership, enforced natively** — not a JS-visible adjacency or work-range rule.
> The terrain whitelist (`city-commands.xml:11-27`, "global … a player can override with a modifier")
> is a real but only *partial* input the native code combines.

---

## 2. Candidate A — radius / range modification → **NOT FEASIBLE**

Verdict confirmed independently by the adversarial verifier. Four independent walls:

1. **No work/expand/claim range effect exists.** The full effect catalog — 26 `DynamicModifier`
   EffectTypes (`modifiers.xml:36-61`) + ~250 distinct `EFFECT_*` ids across all five modules — has
   **nothing** for city tile-working/expansion *distance*. The only RANGE/RADIUS effects are
   trade-route, unit-attack, air-interception, command-radius, WMD-blast. The "WORK" effects
   (`EFFECT_CITY_ADJUST_WORKER_YIELD/_CAP`) are about *specialists*, not distance.
2. **No work-range GlobalParameter exists.** No `WorkRadius`/`WORK_RANGE`/expand-radius row in any data
   XML. The only city-range param is `CITY_MIN_RANGE` (settlement spacing, map-gen only).
3. **GlobalParameters are read-only from JS.** The sole accessor is `GameInfo.GlobalParameters.lookup(name)`
   (`utilities-data.js:60`) — no setter; values change only at data-load via XML `<Replace>`.
4. **No runtime modifier-attach API in the UI isolate.** No `attachModifier`/`createModifier`/
   `applyModifier` anywhere; `GameEffects` exposes only two read-only metadata accessors
   (`building-placement-manager.js:706,710`). Modifiers are XML `<GameModifiers>` applied by the engine.

Even a brand-new XML modifier (which would need `AffectsSavedGames` + a restart, violating our
conventions) has no range-affecting effect *type* to invoke and no way to attach it at runtime.
**Reject Candidate A.**

---

## 3. Candidate B — per-tile city assignment → **FEASIBLE (recommended)**

There are three engine paths that bind a plot to a *specific city* (not just a player). All are
city-scoped (satisfying "don't touch radius globally"):

| # | API | UI-callable? | Distance behaviour | Notes |
|---|---|---|---|---|
| **B1** | `city.Growth.claimPlot({x,y})` | **UNKNOWN** — only call site is `maps/map-utilities.js:449` (gameplay context) | engine map-gen uses it to attach a plot **and place a rural district** — the exact semantics we want | Cleanest fit. Risk = UI-isolate callability (the M3 `Units.create` lesson). |
| **B2** | `city.purchasePlot(loc)` | **yes** (tuner `tuner-input.js:300`) | almost certainly **range/growth/gold-gated** to `canStart(EXPAND).Plots` — this is *why* M4.3 abandoned it for `setOwnership` | Won't reach far tiles. |
| **B3** | `Game.CityCommands.sendRequest(cityID, EXPAND, {X,Y})` | **yes** (`interface-mode-acquire-tile.js:340`) | gated to `canStart(EXPAND).Plots` (adjacent + needs banked growth) | Fully integrated (auto-creates the rural district) but range/growth-limited. |

A fourth, lower-level path can *place the rural district directly* if needed — the M3-proven
`sendRequest` element pattern:

```
tuner-input.js:283-292  Game.PlayerOperations.sendRequest(pid, "CREATE_ELEMENT",
                          { Kind:"CONSTRUCTIBLE"|"DISTRICT", Type, Location:loc, Parent:cityID, Owner:pid });
```

`CREATE_ELEMENT` is exactly how M3 spawns units from the panel (proven UI-isolate-callable), so a
`Kind:"DISTRICT", Type: DISTRICT_RURAL` element parented to the city is a strong fallback for forcing
both territory membership and workability.

### Why B is safe against the hard constraints
- **Scoped to one city / the player's cities** — every B path takes a specific `cityID`; nothing
  global. ✔
- **Unclaimed-tile growth unaffected** — we add a call *on claim*; cities with no cheat-claimed tiles
  hit none of this code. ✔
- **No GlobalParameters mutation** — none of B touches a parameter or the radius, so removing the mod
  can't corrupt the save's growth logic (the data-load tables are untouched). ✔
- **Single-player guard** — stays (`guardSP()` already wraps `claimPlotForCity`). ✔

---

## Recommendation

**Adopt Candidate B, primary mechanism `city.Growth.claimPlot(loc)`, with a fallback chain.** Rationale:

1. It is the engine's *own* "attach this plot to this city and make it a rural-worked tile" call
   (`map-utilities.js:449`, inside `placeRuralDistrict`) — semantically exact for the goal, one call,
   city-scoped, no global side effects.
2. The single real unknown is **UI-isolate callability** — methods that only appear in `maps/` scripts
   have been inert from the panel before (the M3 `Units.create → {Success:false}` lesson). This is a
   one-test question, not a research question.

### Proposed Phase 1.B shape (for approval — not yet implemented)
Rework `claimPlotForCity(city, loc)` to, in order, with before/after instrumentation
(`getOwningCityFromXY`, `getGrowthDomain` length):

1. `setOwnership(player, loc)` — keep it: flips the border at **any distance** (no range cap), which we
   already know works. This alone is today's behaviour.
2. **then** `city.Growth.claimPlot(loc)` if it's a function → attaches the tile to the city's territory.
3. **fallback** if `claimPlot` is absent/inert: `Game.PlayerOperations.sendRequest(pid, "CREATE_ELEMENT",
   {Kind:"DISTRICT", Type: Database.makeHash("DISTRICT_RURAL"), Location: loc, Parent: cityID, Owner: pid})`
   to force a rural district (M3-proven pattern).

The first in-game test of Phase 1.B tells us which step actually binds the tile (the logging makes it
obvious), and we keep the winner.

### Honest caveats to set expectations now
- **Rural improvements + population growth on claimed tiles: expected to work** once the tile is city
  territory + has a rural district.
- **Urban buildings/districts on distant claimed tiles: likely NOT feasible.** Urban tiles auto-place
  *adjacent to the existing urban core* (`DISTRICT_URBAN AutoPlace`); a far exclave can't host an urban
  building without contiguity to the city center. This is the "hard engine constraint" — recommend we
  scope Item 1 to **rural growth + improvements**, and treat urban-on-exclave as out of scope (confirm
  in test 4).
- **Disconnected/exclave territory** (claiming a tile far from the city) may or may not behave well —
  the engine normally keeps city territory contiguous. The in-game test will show whether a far
  `claimPlot` tile is actually workable or whether claims should be kept near the city.
- **Adjacency yields** (e.g. farm-next-to-farm) are computed natively from the placed constructibles, so
  they should compute correctly once the district/improvement exists.

### Note on the two mod copies (not a bug)
A verifier flagged that the **public** `sam-cheat-panel/api.js` calls `city.purchasePlot` while git HEAD
(`5b07ac6`) uses `setOwnership`. That is **expected** — the public copy is intentionally the
pre-`5b07ac6` (M4.3) version; see `docs/workshop-publishing.md`. This Item-1 fix targets the **local
`src/`** version (the `setOwnership` one).

---

## Verified API reference (call-site-backed)

| API | Signature | UI-callable | Source |
|---|---|---|---|
| `WorldBuilder.MapPlots.setOwnership` | `(playerID, loc)` — player border only | yes | `tuner-input.js:96` |
| `GameplayMap.getOwner` | `(x,y) → playerID` | yes | `city-borders-layer.js:59` |
| `GameplayMap.getOwningCityFromXY` | `(x,y) → cityID|null` | yes | `interface-mode-acquire-tile.js:85` |
| `city.getPurchasedPlots` | `() → number[]` (territory set) | yes | `city-borders-layer.js:92` |
| `city.Growth.getGrowthDomain` | `(excludeHidden) → number[]` (read-only) | yes | `worker-yields-layer.js:82` |
| `city.Growth.claimPlot` | `(loc)` — attach plot to city + rural district | **unknown** | `maps/map-utilities.js:449` |
| `city.purchasePlot` | `(loc)` — city claim, range-gated | yes | `tuner-input.js:300` |
| `Game.CityCommands.canStart(EXPAND)` | `(cityID, EXPAND, {}, false) → {Plots, ConstructibleTypes}` | yes | `model-place-population.js:91` |
| `Game.CityCommands.sendRequest(EXPAND)` | `(cityID, EXPAND, {X,Y})` — auto-builds rural district | yes | `interface-mode-acquire-tile.js:340` |
| `Game.PlayerOperations.sendRequest("CREATE_ELEMENT")` | `(pid, "CREATE_ELEMENT", {Kind,Type,Location,Parent,Owner})` | yes | `tuner-input.js:283` |
| `MapCities.getDistrict` / `Districts.get` | `(x,y) → districtID`; `(id) → {type,…}` | yes | `world-input.js:312` |
