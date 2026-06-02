# Discovery — Creative tab audit + Natural Wonders (Item 3)

_Audit only — no code was changed. Base game unpacked at `…\Base\modules\` (build 23245653 / Update
1.4.0 "Test of Time"). Cross-verified against base source. This doc drives the follow-up decision on what
to fix/build in the Creative tab._

---

## Part A — Natural Wonders research (re-verified for Test of Time)

**Headline:** natural wonders are **plain map FEATURES** flagged as wonders by a row in
`Feature_NaturalWonders`. There is **no** `isNaturalWonder` column and **no** `NATURAL_WONDER` feature
class — wonder-ness = "this `FeatureType` has a `Feature_NaturalWonders` row."

1. **Definitions / count.** Base set = 12 in `base-standard/data/terrain.xml:224-235` (Barrier Reef,
   Valley of Flowers, Redwood Forest, Grand Canyon, Gullfoss, Hoerikwaggo, Iguazu Falls, Kilimanjaro,
   Zhangjiajie, Thera, Torres del Paine, Uluru). Test of Time adds **2** via DLC data files that
   `base-standard.modinfo:399-402` loads: `FEATURE_BERMUDA_TRIANGLE` (`racetowonders-terrain.xml`) and
   `FEATURE_MOUNT_EVEREST` (`marvelous-mountains-terrain.xml`). **14 total.** Each is also a normal
   `KIND_FEATURE` (`terrain.xml:60-71,210-221`).
2. **Single- vs multi-tile.** `Feature_NaturalWonders.Tiles` (1–4) + the `Features.PlacementClass` string
   (`ONE`, `TWOADJACENT`, `THREETRIANGLE`, `FOURADJACENT`, `FOURL`, `FOURPARALLELAGRM`,
   `THREETRIANGLEDEEPOCEAN`). The actual tile-offset template for each shape is **hardcoded in gamecore**,
   not enumerated in data. Single-tile wonders (`Tiles=1`): **Uluru, Gullfoss, Iguazu Falls**.
3. **Placement requirements** (data-driven, enforced natively): `Feature_ValidTerrains`
   (`terrain.xml:265-276`), `Feature_ValidBiomes` (`:305-317`), `TypeTags` (`:135-153`, e.g.
   `ADJACENTMOUNTAIN`, `NOTNEARCOAST`, `SHALLOWWATER`, `ADJACENTTOLAND`), and per-feature scalars
   (`MinimumElevation`, `NoRiver`, `NoLake`). No distance-from-other-wonders/cities rule lives in the
   data — map spacing is just the generator's candidate scan.
4. **Runtime placement API** — the important part:
   - **`WorldBuilder.MapPlots.setFeature(featureHash, loc)`** — UI-isolate-callable (the tuner uses it,
     `tuner-input.js:48`; **our `api.paintPlot` already calls it**, `api.js:420`). 2-arg, no Direction.
     ❓ **Unverified whether it correctly fans out a *multi-tile* wonder** (Tiles>1) — single-tile wonders
     are the safe case.
   - **`TerrainBuilder.setFeatureType(x,y,{Feature,Direction,Elevation})`** + **`canHaveFeatureParam(...)`**
     — the map-gen calls that *do* place multi-tile wonders in one call on the anchor
     (`natural-wonder-generator.js:57,83`). **BUT referenced in ZERO `ui/` files (only `maps/`)** → high
     risk of being **inert from the panel isolate**, exactly like `Units.create` was. Must be probed.
   - **`Game.PlayerOperations CREATE_ELEMENT`** — `Kind` ∈ {UNIT, CITY, DISTRICT, CONSTRUCTIBLE}; **no
     feature/wonder kind** → cannot place natural wonders.
   - **`MapConstructibles.addDiscoveryType(hash,x,y)`** — for single-tile *discoveries* (goody-huts), not
     wonders. Wrong tool.
5. **Visual refresh.** Same deferred-redraw limit as terrain paint — mesh doesn't update until camera move
   / next turn (no refresh call after `setFeature` in `tuner-input.js`; our `paint-tile-mode.js:20-22`
   already documents this).

**NW takeaway:** a "place natural wonder" cheat is feasible only for **single-tile wonders** via the
already-wired `setFeature` path (likely needing terrain+biome pre-set to satisfy validity). **Multi-tile
wonders** need `TerrainBuilder.setFeatureType`, whose panel-isolate callability is unverified and
probably inert — so multi-tile NW is **high-risk / possibly not feasible** from the mod.

---

## Part B — Creative-tab audit

The Creative tab (`tab-creative.js`) is a single **Map Paint** panel: 4 category buttons
(Terrain/Feature/Resource/Biome) → scrollable type picker → status line → **[Paint at clicked tile]** →
enters `INTERFACEMODE_LCP_PAINT_TILE`; each plot click → `api.paintPlot` →
`WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome}`. The write path is sound (it's the exact tuner
path, UI-isolate-verified).

### B1. Feature inventory & status

| Feature | What it does | API | File | Status |
|---|---|---|---|---|
| Category selector | Toggle Terrain/Feature/Resource/Biome; persists across tab switches | UI state → `getMapPaintTypes` | `tab-creative.js:54-74` | ✅ works |
| Type picker list | Lists every row in the category's `GameInfo` table | `api.getMapPaintTypes` | `tab-creative.js:87-118`, `api.js:392-409` | ⚠️ caveat — **unfiltered**: Feature list includes multi-tile NWs + impassable/non-removable features that single-tile `setFeature` can't place; no per-tile legality |
| Status line | "Selected: <cat> = <type>" | — | `tab-creative.js:46-52` | ✅ works |
| Paint at clicked tile | Closes panel, enters paint mode | `api.enterPaintMode` | `tab-creative.js:77-85`, `api.js:432-441` | ✅ works (guarded; DB row present) |
| Paint commit (per click) | Paints type at plot + green flash; stays active | `api.paintPlot` → `WorldBuilder.MapPlots.set*` | `paint-tile-mode.js:159-177`, `api.js:412-428` | ⚠️ caveat — (1) mesh doesn't redraw until camera/next-turn; (2) **false-positive flash**: illegal combos are silently dropped but the flash still fires; (3) resource amount hardcoded to 1 |
| Hover overlay | Yellow cursor highlight | overlay API | `paint-tile-mode.js:145-152` | ✅ works |
| Exit banner | "Esc/right-click to exit" hint | DOM | `paint-tile-mode.js` | ⚠️ → **fixed in Item 2** (Esc now actually exits; banner+✕ moved to shared base) |
| Terrain / Biome paint | set terrain/biome on plot | `setTerrain`/`setBiome` | `api.js:419,422` | ⚠️ caveat — applies server-side, needs camera/next-turn redraw; land↔water without fixing biome/feature can look inconsistent |
| SP guard | blocks paint in multiplayer | `api.guardSP()` | `api.js:413,433` | ✅ works (on both entry + per-plot) |

### B2. Code-quality flags

- **Duplicated category maps**: `CATEGORIES` (`tab-creative.js:15`) vs the table/column maps
  (`api.js:394-395`) — same four categories in two places.
- **Resource amount hardcoded to 1** (`api.js:421`); tuner exposes a configurable amount and uses `0` to
  erase (`tuner-input.js:171`). No amount UI, no erase path.
- **No validity pre-filtering**: `getMapPaintTypes` returns every row; `proposePlot` accepts any in-bounds
  plot; relies entirely on the engine silently rejecting bad combos. Base gates with
  `TerrainBuilder.canHaveFeatureParam` / `ResourceBuilder.canHaveResource` (unused here).
- **False-positive success feedback**: green flash fires whenever `paintPlot` returns true, but `set*`
  returns success even when the engine later drops an illegal value. No read-back
  (`GameplayMap.getFeatureType/getResourceType`) to confirm.
- **Stale doc comments**: `tab-creative.js` / `claim-tile-mode.js` headers still describe claim as
  `city.purchasePlot`, but it's `WorldBuilder.MapPlots.setOwnership` since `5b07ac6`.
- **Per-plot `api.LOG`** in `paintPlot` (`api.js:425`) — spammy during multi-tile painting.
- **Overlay color literals** duplicated between paint and (conceptually) claim decoration.

### B3. Gap analysis vs target feature set

| Want | Closest existing | New APIs needed | Effort | Risk |
|---|---|---|---|---|
| **Resource ADD** | Resource paint already calls `setResource(hash,loc,1)` (`api.js:421`) — works today | none required; optional `ResourceBuilder.canHaveResource` pre-filter (maps-only, unverified) + amount arg | **S** | low |
| **Resource DELETE** | same `setResource` dispatch | `WorldBuilder.MapPlots.setResource(ResourceTypes.NO_RESOURCE, loc, 0)` — confirmed in `tuner-input.js:171`; `NO_RESOURCE` already used at `api.js:523` | **S** | low |
| **Natural-wonder ADD** | Feature list already paints NWs via single-tile `setFeature` — but ignores multi-tile shape/Direction → effectively broken for real NWs | single-tile: works via `setFeature` (+ maybe pre-set terrain/biome). multi-tile: `TerrainBuilder.setFeatureType`/`canHaveFeatureParam` (**unverified / likely inert from panel**) + shape data from `Feature_NaturalWonders`/`PlacementClass` | **L** | high |
| **Terrain painting** | `setTerrain` (`api.js:419`) — works today | none for the write; polish: refresh nudge, land/water domain awareness | **S** | medium |

### B4. Recommended fix order (recommendation, not a decision)

1. **Resource DELETE** (S, low) — `setResource(NO_RESOURCE, loc, 0)`; exact tuner pattern, reuses
   `paintPlot` dispatch. Wire as right-click in Resource mode (mirrors tuner) or a "Clear" affordance.
2. **Harden Resource ADD** (S, low) — group list by `ResourceClassType`, expose amount, add post-write
   read-back so the flash only fires on confirmed success.
3. **Trustworthy feedback** (S/M, low) — add the read-back so `commitPlot` flashes **red** on silent
   rejection. (Esc exit itself is already fixed in Item 2.) Do this before adding more painters since all
   inherit the feedback.
4. **Filter the Feature picker** (S, medium) — hide multi-tile NWs (`Feature_NaturalWonders.Tiles>1`) and
   non-removable/impassable hazards; surface single-tile NWs as paintable. Stops silent-reject confusion;
   prerequisite for a dedicated NW tool.
5. **Natural-wonder ADD** last (L, high) — first **probe** whether `TerrainBuilder.setFeatureType`/
   `canHaveFeatureParam` are live from the panel isolate (log-only). If live → dedicated NW tool reading
   `Feature_NaturalWonders` for Tiles/shape + validating before placing. If inert → ship only single-tile
   NWs (step 4) and document multi-tile NW as not feasible without a gameplay-context shim.

**End of audit — awaiting your follow-up decision on what to fix/build.**
