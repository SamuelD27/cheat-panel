# Local Cheat Panel — Build Status & Handoff

_Last updated: 2026-05-29. Read this first to resume work._

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
| **M4.1-fix** | Revert game-scope `input.xml` registration (it broke loading ALL saves) | ✅ **verified 2026-05-27** (save loads again) | `061ccde` |
| **M4.2** | Cities tab: per-row [Grow] → native tile picker, claim adjacent tiles (claim-only) | ✅ claim works (verified) — but EXPAND is **gated on a pending growth** (1 claim per natural growth) | `45e7378` |
| **M4.2-fix** | Guard [Grow]: don't enter the picker with 0 claimable plots (was soft-locking the player); show an inline hint instead | ✅ **verified 2026-05-27** (works; growth- & radius-gated) | `8995e65` |
| **M4.3** | Cities tab: per-row **[Claim]** → custom map-click mode (`INTERFACEMODE_LCP_CLAIM_TILE`) to add ANY plot to the city via `city.purchasePlot`, no radius/growth limit | ⚠ first attempt opened the picker but no plots were selectable (engine: _"Interface Mode '…' not defined in Database"_); see M4.3-fix | `74adfa2` |
| **M4.3-fix** | Register `INTERFACEMODE_LCP_CLAIM_TILE` in the gameplay `InterfaceModes` table (`database/interface-modes.xml`, game-scope `<UpdateDatabase>`); `InterfaceMode.switchTo` rejects modes not present in DB even when a JS handler is registered | ✅ **verified 2026-05-28** (claim works, including beyond 3 rings) | `10968eb` |
| **M5** | Map tab: paint terrain/feature/resource/biome on a clicked plot via `WorldBuilder.MapPlots.set*` + custom `INTERFACEMODE_LCP_PAINT_TILE` (mode stays active across clicks; Esc/right-click exits) | 🟡 **implemented & deployed (new files + modinfo + DB → needs RESTART), NOT yet verified** | `ddbf01b` |
| **M5.1** | Panel restyle (light touch): flat fills (no gradients), bronze-dimmed gold, thinner less-yellow borders, less-rounded corners, darker row backgrounds. CSS-only override scoped to `.cheat-frame`; structural `fxs-*` components untouched | ⚠ shipped but the restyle wasn't visible (only caught our plain DOM buttons, not the Civ `fxs-button` controls in Player/Units/Cities/Research tabs); see M5.1-fix | `6ce991b` |
| **M5.2** | In-panel **Map Preview** minimap: read-only canvas rendering of the full map (terrain + biome tint + hills + mountain + rivers + natural wonders). Filter toggles: Cities, Resources. Pure `GameplayMap.*` reads — does NOT touch fog-of-war or grant in-game vision | ⚠ shipped but: native `<input type=checkbox>` widened the panel on click (Gameface mishandled them), map too small to read, no "Me" filter for own units; see M5.2-fix | `e683275` |
| **M5.1-fix** | Restyle catches `fxs-button` too: filter `saturate(0.6) brightness(0.88)` on every `fxs-button` (light DOM, verified in core/ui/components/fxs-button.js); plus translucent inset shadow over `.cheat-frame` to dim the parchment backdrop. Canvas + type-list are `filter:none` so their colors stay accurate | 🟡 **implemented (JS-only Reload UI), NOT yet verified** | `4a24ed2` |
| **M5.2-fix** | Filters become **toggle buttons** (no native `<input type=checkbox>`), **default tile size 8px** with **zoom −/+** buttons (2..20px range), new **Me** filter renders the local player's units as small triangles in the civ's primary color (no AI tracked). Status line reports zoom + counts | 🟡 **implemented (JS-only Reload UI), NOT yet verified** | `4a24ed2` |
| **M5-feedback** | Paint mode visual feedback: **yellow cursor overlay** under the hovered plot (`decorateHover`) so the picker visibly tracks you, and a **green flash** at the clicked plot for ~2s (`commitPlot`). Resolves the "click but nothing selects it" report — the engine often doesn't refresh terrain mesh until camera-pan/end-turn (tuner has the same limitation), so this is the per-click confirmation | 🟡 **implemented (JS-only Reload UI), NOT yet verified** | `f7b73f1` |
| **M5.x-fix2** | Map fixes from the verify round: civ colors were black/white (`primaryColor` is already 0..255 — the old `*255` overflowed to white); minimap was scaled down by `max-width:100%` (now pins pixel size + scrolls); stale module-level snapshot showed empty filters (now re-reads on every Map-tab open) | 🟡 **implemented (JS-only Reload UI), NOT yet verified** | `74e2562` |
| **M6-restyle** | Full **dark + gold** reskin of the WHOLE panel (strips Sovereign parchment/9-slice/filigree; re-skins engine `fxs-button`/`fxs-tab-bar`/`fxs-header`; locks the frame to a fixed 26×42rem so it stops resizing between tabs, content scrolls internally). **Root-cause fix:** the panel runs in a *separate Gameface document*, so the `<style>` was being appended to the wrong `document.head` and never applied — now appended into `this.Root.ownerDocument`. This is why **every prior restyle "didn't show up"** | 🟡 **implemented (JS-only Reload UI), NOT yet verified** | `74e2562` |
| **M6** | Remaining polish: steppers, drag-persist, conflict-detect, banners, docs | ⬜ pending | — |

## ▶ Immediate next action: Reload UI, verify M6-restyle + M5.x-fix2

JS-only (`cheat-panel.js`, `api.js`, `tab-map.js`) — no `.modinfo` / database / new files.
In-game: `~` → UI → **Reload UI** (no restart needed).

### 🔑 Key discovery (2026-05-29) — the panel lives in a SEPARATE Gameface document
Every earlier restyle (M5.1, M5.1-fix) "didn't show up" because `injectPanelStyles()` appended its
`<style>` to the module-global `document.head` — but `panel-lcp` renders in a **different Gameface
view/context**, so that `<style>` landed in the wrong document and never matched `.cheat-frame`. The
fix: append into `(this.Root && this.Root.ownerDocument) || document`. (This is almost certainly the
**same context split** behind the "`LCP:` console.logs never reach UI.log" diagnostic — our logs go
to the panel-isolate console, not the main UI log.) With styles now landing in-scope, the M6 reskin
also *recolors* the `fxs-button` gold 9-slice by nulling its `background-image` and painting a flat
fill — `filter: brightness` alone (the M5.1-fix approach) could never recolor a texture, which is the
secondary reason the dim never read as a restyle.

### M6-restyle + M5.x-fix2 test plan (Reload UI)
1. Open the panel (dock skull). It should now look **clearly different** — a flat **dark** panel with a
   thin **gold** edge, no parchment backdrop, no filigree ornaments. Drag (grab header), tab switches,
   F8/dock-skull open, and the X close must all still work.
2. The frame should be a **fixed size** and **not resize** as you switch tabs — long tabs scroll
   internally instead of growing the panel.
3. Engine buttons (Player/Units/Cities/Research tabs) should be **dark with gold labels/edges** like our
   own row buttons — not the old gold-gradient Civ buttons. Tab bar: gold 2px underline under the
   selected tab, selected tab label brighter.
4. **Map** tab → minimap should be **large and readable** now (pinned pixel size; scrolls inside its box
   if bigger than the panel). Toggle **Cities** / **Me** / **Resources** — markers appear/disappear.
5. **Cities** and **Me** markers must show in the **civ's real color** (not black, not white). This is the
   `*255` fix — if a city/unit marker is white or black, the color assumption is still wrong; report it.
6. Open Map tab, then switch away and back (or found a city / move the settler, then reopen Map) — the
   snapshot should **re-read** and reflect the current state (no more permanently-empty filters).

### 🛑 M5.1 + M5.2 issues found & fixed (2026-05-28, post-restart)

**Symptoms reported in-game:**
1. **Restyle didn't show.** The panel still looked like the unmodified Civ panel.
2. **Filter checkboxes broken.** Clicking Cities/Resources widened the panel and added a huge black band beside the minimap.
3. **Minimap too small to read** ("just a bunch of pixels").
4. **No way to see own units** — the user wants to find their starting settler/colon on a new game without revealing AI.

**Root causes:**
1. The M5.1 CSS only targeted MY plain DOM buttons (`.lcp-row-btn`, `.lcp-toggle-btn`). The Player/Units/Cities/Research tabs are full of `<fxs-button>` controls, which keep the engine's gold-gradient `border-image: url("blp:base_button-bg")` look (verified in `core/ui/components/fxs-button.js` — light DOM, classes `fxs-button__bg--base/focus/active/disabled`). So the visible "main" buttons were unchanged.
2. Coherent Gameface in this build renders native `<input type=checkbox>` with a huge intrinsic size and flaky `change` event handling, which pushed the panel layout sideways.
3. Default tile size was `max(2, floor((wrapW-8) / (W+0.5)))` ≈ 4px on standard maps. Way too small to read terrain shape or distinguish features.
4. The snapshot collected cities + resources only; no own-unit data.

**Fixes:**
1. **M5.1-fix:** add `filter: saturate(0.6) brightness(0.88)` to `.cheat-frame fxs-button` (and lighter values to `fxs-tab-bar` / `fxs-header`). Also a translucent inset `box-shadow` on `.cheat-frame` dims the parchment backdrop. Minimap canvas + type-list explicitly `filter: none` so their colors are not desaturated.
2. **M5.2-fix:** filters are now **toggle buttons** (the same `.lcp-row-btn .active` pattern we know works in this build). No native checkboxes anywhere.
3. **M5.2-fix:** default zoom **8 px/tile** with **−/+ buttons** (range 2..20). Canvas wrap is `max-width:100% min-width:0 max-height:22rem overflow:auto`, so a wide/tall canvas scrolls inside the wrap and never pushes panel layout.
4. **M5.2-fix:** new **"Me"** toggle. `api.getMapSnapshot({includeMyUnits:true})` iterates `getLocalPlayer().Units.getUnits()` and returns `myUnits: [{x, y, name, kind, color}]` — **local player only** (no AI / no other-player units, per the request). Rendered as small filled triangles in the civ's primary color so they're distinct from city squares and can sit on the same tile (e.g. settler in your capital). Status line now reports your unit count too.

_Lessons:_
- Civ7 `fxs-button` is light DOM with composable `.fxs-button__bg--*` layers — restylable from outside, but our CSS must explicitly target it (parent-class overrides like `.cheat-frame .lcp-row-btn` do **not** apply to children-of-fxs-button).
- Native form controls in Coherent Gameface are a layout hazard in this build — always use custom button widgets with `.active`/no-`.active` classes.

### 🛑 Diagnostic finding (2026-05-28) — our `LCP:` log lines do NOT reach UI.log
While debugging the paint-mode "click doesn't select" report, I tailed UI.log and found **zero** lines containing `LCP:` even though the panel is loading and other panel behavior works (tracking, zoom). The mod's `console.log('LCP:', ...)` output is being routed somewhere other than the UI.log file on this build. Other mods' `console.log` lines (e.g. `[JERSEY-PICKER] color module loaded`) DO appear, so some context difference (panel isolate vs. main UI isolate?) determines whether logs reach the file. **For now: do not rely on `LCP:` log lines in `UI.log` for verification — confirm features by visible in-game behavior instead.** All API errors still surface via the engine's own error path (e.g. the M4.3 "Interface Mode '…' not defined in Database" warning), so genuine engine failures are visible; it's only our voluntary log markers that are missing. (Followup: investigate `engine.log` or a different logger; for now, paint mode uses **visible overlay flashes** for per-click confirmation instead of log markers.)

### 🛑 M5 paint-mode "click doesn't select" (2026-05-28)
**Symptom:** clicking [Paint at clicked tile] enters the picker ("asks me to select a case") but clicking a plot has no visible effect.
**Diagnosis:** the engine's terrain mesh does NOT refresh on `WorldBuilder.MapPlots.set*` calls until the camera moves over the plot or the next turn — the in-game tuner has the same limitation (no refresh call in `base/.../tuner-input.js`). Combined with paint mode having **no built-in engine feedback** (unlike claim mode, where `city.purchasePlot` shifts the border colour immediately), the click registers but you can't see it.
**Fix (M5-feedback):** override `decorateHover` to paint a **yellow cursor overlay** under the hovered plot so the picker visibly tracks the mouse, and on `commitPlot` flash a **green overlay** at the painted plot for ~2s. The flash also confirms success — if `set*()` rejects the combo silently, we don't flash. Terrain itself still won't redraw until camera pan / end-turn — that's an engine limitation; the flash IS the per-click confirmation.



(Since all three landed before the restart, one restart covers them. M5 alone forces the restart — M5.1
and M5.2 are JS-only and would otherwise be Reload-UI-only.)

### M5.1 — Panel restyle (light touch)
CSS-only override in `injectPanelStyles()` (`cheat-panel.js`): gradient buttons → flat fills;
gold tone darkened from `#e8c860` toward `#c5a042` (bronze); borders thinner and less yellow
(`#5a481c`); corners less rounded; row backgrounds darker. Active state changes from gold-green
gradient to flat teal-green (`#4a9970`). The structural `fxs-*` components (subsystem-frame,
header, tab-bar) and the parchment backdrop are untouched, so drag / tabs / close / open animation
all keep working. A new `.lcp-section` style is added for the M5.2 section dividers.

**Test:** the panel should look noticeably flatter and less ornate but still gold/bronze themed.
Confirm drag still works (grab the header), tab switches still work, F8/dock skull still opens.

### M5.2 — In-panel Map Preview minimap (with filters)
New section at the **top of the Map tab** ("── Map Preview ──"), above the paint controls. A canvas
renders the full map from a one-pass `api.getMapSnapshot()` that calls only read-only
`GameplayMap.*` APIs (no fog/visibility mutation, no save-state changes, **no in-game vision granted**):
- Terrain colors: ocean (deep blue), coast (mid blue), navigable river (lighter blue), mountain (grey),
  land tiles tinted by biome (grassland/plains/tropical/desert/tundra), hills darken the biome tint by ~28%.
- **Rivers**: thin bottom-edge stripe per plot — light blue for `RIVER_MINOR`, deeper blue for
  `RIVER_NAVIGABLE` (per `RiverTypes` from base `ui-next/tooltips/plot-tooltip/helpers.js`).
- **Natural wonders**: gold center pip (`GameplayMap.isNaturalWonder`).
- **Cities** (filter checkbox; default ON): square in the civ's primary color
  (`UI.Color.getPlayerColors(pid).primaryColor`), white outline if capital, black otherwise.
- **Resources** (filter checkbox; default OFF): center dot colored by `ResourceClassType` —
  strategic (red), luxury (purple), bonus (green), treasure (gold), factory (orange).

Tile size auto-scales to the panel width (min 2px, ~4px on standard maps). Y axis is flipped so plot
y=0 is at the bottom (Civ minimap orientation); odd rows are offset by half a tile (hex). Snapshot is
cached at module level — toggling filters is instant; **[Refresh]** invalidates the cache and re-reads
the map. A short legend under the canvas labels the markers; a status line shows
`<W>×<H> map · N cities · M resources`.

**Test plan after restart** (run all three in sequence):
1. Open the panel (dock skull). Glance over the whole UI — does it look flatter and less ornate (M5.1
   restyle)? Tabs / drag / close should still work normally.
2. Switch to **Map** tab. Wait ~50–100ms for "Reading map…" → canvas paints (M5.2).
   - Land/sea/mountain shapes should match the actual map. Rivers visible as thin blue stripes; natural
     wonders show as gold pips. Cities visible by default in civ colors.
   - Toggle **Cities** off / on — city dots appear and disappear instantly.
   - Toggle **Resources** on — strategic/luxury/bonus dots appear. Toggle off to hide.
   - Click **[Refresh]** — should re-read and redraw (useful after painting changes or new turn).
3. Below the preview, the existing **── Map Paint ──** section is the M5 paint UI (Terrain / Feature /
   Resource / Biome → pick a type → [Paint at clicked tile]). Test it per the original M5 plan:
   - Pick a category, pick a type, click [Paint], click a plot — terrain should change (may need a
     camera move or end-turn to redraw visually).
   - Esc/right-click exits cleanly. UI.log filter `LCP:` should show `LCP: paint <Cat> <TYPE> at (x,y)`.

**Open ❓ to confirm in-game (M5.2-specific):**
- Y orientation: if the minimap looks vertically flipped vs the actual map, I had a wrong assumption
  about plot-Y origin and will flip it (one-line change).
- Civ color brightness: `UI.Color.getPlayerColors(pid).primaryColor` returns normalized 0..1 floats per
  the base trade-route-chooser. If colors look black, that assumption is wrong and the values are
  already 0..255 — also a one-line change.
- Performance: the snapshot is ~6k plots iterated. Should be sub-100ms; if "Reading map…" hangs more
  than a second, report and I'll chunk it.



### M5 — Map tab: paint terrain/feature/resource/biome on a clicked plot
New 5th tab **Map** between Cities and Research. Layout:
- 4 category buttons: **[Terrain] [Feature] [Resource] [Biome]** (one active).
- A status line ("Selected: Terrain = TERRAIN_GRASS").
- **[Paint at clicked tile]** button → panel closes → enters `INTERFACEMODE_LCP_PAINT_TILE`
  (custom map-click mode, `paint-tile-mode.js`, subclass of `ChoosePlotInterfaceMode` like the M4.3
  Claim mode). Every plot click applies the current paint via
  `WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome}` (tuner-input.js path) using
  `Database.makeHash("TERRAIN_GRASS")` as the type arg. Mode **stays active** across clicks; **Esc /
  right-click** exits cleanly.
- A scrollable list of all valid types for the active category (enumerated from
  `GameInfo.{Terrains,Features,Resources,Biomes}`, with localized names — hover shows the raw `*Type`
  string used for the `makeHash` argument).

Resource paint passes a count of 1 (matching the tuner's normal-case third arg).

Both pre-flight lessons from M4.3 are applied: handler is registered in JS (`InterfaceMode.addHandler`)
AND `INTERFACEMODE_LCP_PAINT_TILE` is declared in `database/interface-modes.xml` (game-scope
`<UpdateDatabase>`) — otherwise the picker view opens but no plot input reaches the handler.

**Needs a FULL GAME RESTART** (new files `tab-map.js` + `paint-tile-mode.js` added to modinfo
`<ImportFiles>`, new tab-bar entry, new DB row, new LOC string). After restart:
1. Open the panel (dock skull) → switch to the **Map** tab.
2. Default category is **Terrain**. Type list should be populated (Grass, Plains, Coast, Mountain,
   Hills, etc.). Click one — it highlights and the status line updates.
3. Click **[Paint at clicked tile]**. Panel closes; you're in the paint picker (camera stays put).
4. Click any plot on the map. Watch for the terrain visually changing (terrain may need a redraw —
   moving the camera over the plot usually triggers it; or the next turn).
5. Click several plots — the mode **stays active** between clicks (matches Claim mode).
6. Press **Esc** or right-click → mode exits cleanly, no soft-lock.
7. In `UI.log` filter `LCP:` — each paint logs `LCP: paint Terrain TERRAIN_GRASS at (x,y)`.
8. Switch category to **Feature** (Forest, Marsh, etc.), **Resource** (Iron, Horses, etc.), or **Biome**
   (Tropical, Tundra, etc.) → repeat. (Resource takes a count of 1; tuner uses the same.)

**Open ❓ to verify in-game:**
- Some types may visually fail to refresh until the next turn or until the camera moves over them
  (`tuner-input.js` has comments about terrain refresh elsewhere). If a paint doesn't show, end-turn
  and re-check.
- Some Terrain values (e.g. `TERRAIN_OCEAN`) on land plots may need a Biome change too. If a paint
  rejects silently, the log won't show an error (`set*` doesn't return a result). Try a likelier-valid
  combo (Grass on a Flat plot) first.
- Resource amount fixed at 1 — works for normal strategic resources. Will revisit if specific resources
  need a different count.

### (resolved) M4.3 first-attempt issue & fix (2026-05-28)
**Symptom (reported in-game):** clicking **[Claim]** opened the plot picker (UI/camera switched), but **no
plots were selectable** — same dead-end UX as the M4.2 "no pending growth" soft-lock.
**Root cause (confirmed in `UI.log`):** the engine logged repeatedly
`Interface Mode 'INTERFACEMODE_LCP_CLAIM_TILE' not defined in Database.` Registering a JS handler via
`InterfaceMode.addHandler` is **not** sufficient — `InterfaceMode.switchTo` also requires a matching row
in the gameplay `InterfaceModes` table. Without it the engine partially enters the mode (view switches)
but never delivers plot input to our handler, so `proposePlot` is never called.
**Fix (file added + modinfo changed → FULL RESTART required):**
- New `src/database/interface-modes.xml` adds `<Row InterfaceModeType="INTERFACEMODE_LCP_CLAIM_TILE"
  ViewName="Placement"/>` (`Placement` matches every other `ChoosePlotInterfaceMode` subclass —
  ACQUIRE_TILE, DIPLO_CLAIM_PLOT, PLACE_BUILDING).
- Registered as `<UpdateDatabase><Item>database/interface-modes.xml</Item></UpdateDatabase>` in the
  **game-scope** ActionGroup. _Safety check (re: M4.1 regression):_ `InterfaceModes` **is** a gameplay
  table (loaded from `base-standard/data/interface-modes.xml` in game scope), unlike `input.xml` which
  is shell-only — so a game-scope `<UpdateDatabase>` is correct here and won't break save loading.
_Engine lesson:_ interface modes are dual-registered — XML defines the type+ViewName, JS provides the
handler. Both are required; missing either yields the silent "picker opens but nothing's clickable"
failure.

### M4.3 — [Claim]: add any plot to a city, no radius/growth limit (scope chosen by user: claim-only)
New per-row **[Claim]** button → `api.enterClaimMode(city)` → custom `INTERFACEMODE_LCP_CLAIM_TILE`
(`src/ui/cheat-panel/claim-tile-mode.js`, a subclass of the base `ChoosePlotInterfaceMode`). The panel
closes, the camera pans to the city, then **click any plot on the map** to claim it for that city via
`city.purchasePlot(loc)` (the tuner's UI-callable path). The mode **stays active** so you can claim
several tiles; **Esc / right-click** exits.

**Needs a FULL GAME RESTART** (new file `claim-tile-mode.js` added to modinfo `<ImportFiles>` + a new
side-import in `cheat-panel.js`). After restart:
1. Cities tab rows now show **[+Pop] [Prod] [Grow] [Claim]**.
2. **[Claim]** → panel closes, camera centers the city; clicking an adjacent plot adds it to the city.
3. **The real test — click a plot well BEYOND 3 tiles** from the city. Does it get claimed?
   - `UI.log` will show `LCP: claimPlotForCity: purchasePlot (x,y) … owning-city before: … after: …`.
   - If `after` = this city's id → 🎉 unlimited claim works. If ownership doesn't change beyond ~3
     rings → `purchasePlot` is radius-capped; next iteration switches to
     `WorldBuilder.MapPlots.setOwnership(playerID, loc)` (any distance, but player- not city-level).
4. Watch for any **gold deduction** on claim. If it charges gold (and that's unwanted), I'll pre-grant
   to cover it. Confirm **Esc / right-click** cleanly exits the mode (no soft-lock).

### (resolved) Reload-UI verifications from the previous round

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

✅ **Verified 2026-05-27:** "Continue Game" loads the save again — the regression is fixed.

### 🛑 M4.2 soft-lock found & fixed (2026-05-27)
**Symptom:** [Grow] worked once (claimed a tile), but it was **limited to one tile per natural
population growth**. Clicking [Grow] again with no pending growth dropped the player into the tile
picker with **nothing claimable and no obvious way out** (soft-lock).
**Root cause (confirmed in base source):** the picker's valid plots come from
`Game.CityCommands.canStart(cityID, EXPAND, {}, false).Plots` (`model-place-population.js:91`), which is
**empty unless `city.Growth.isReadyToPlacePopulation`** — i.e. EXPAND is **gated on a pending growth**.
With 0 expand plots the picker still opens for a full city (specialist/worker tiles keep
`AcquireTileInterfaceMode.initialize()` returning true), so the player is stuck.
**Fix (JS-only → Reload UI):** `api.growCity()` now checks `cityExpandPlotCount()` first and **only**
enters `INTERFACEMODE_ACQUIRE_TILE` when ≥1 plot is claimable; otherwise it shows an inline hint and
does nothing. (Escape an existing soft-lock with **Esc / right-click**, or `~` → UI → **Reload UI**.)

**Test plan (Reload UI — JS-only change):**
1. City **with** a pending growth → **[Grow]** opens the picker, claim an adjacent tile. (works)
2. City with **no** pending growth → **[Grow]** shows the yellow hint, does **not** open the picker
   (no soft-lock). Optionally confirm `UI.log`: `LCP: growCity: EXPAND offers 0 plot(s)`.

### ❓ Decision pending: "grow as I want" (unlimited, player-chosen tiles)
The native picker is hard-gated on pending growth, so true unlimited growth needs a different path.
Candidate: **`city.Growth.claimPlot({x,y})`** (`base-standard/maps/map-utilities.js:449`) claims a plot
with no growth gate — BUT it is only ever called from **map-generation scripts**, never from `ui/`, so
per the M3 lesson it may be **inert from the panel's UI isolate** (like `Units.create` was). It would
also need a **custom adjacent-tile picker** (the native one won't populate without growth). This is an
experimental multi-step feature; awaiting user direction before building it.

**Re: F8 in-game** — F8 now opens the panel **only at the main menu** (shell scope). In-game, use the
**dock skull button** (works). A correct in-game F8 needs a JS-level key approach (not a DB action);
tracked as a follow-up.

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
- ✅ **RELINQUISH IS possible after all** (earlier "not supported" conclusion was WRONG). The tuner
  uses `WorldBuilder.MapPlots.setOwnership(PlayerIds.NO_PLAYER, loc)` to clear a plot's owner
  (`tuner-input.js:206`). So a "release tile" cheat is feasible at the plot-ownership level.
- 🎯 **NEW (2026-05-27) — UI-callable claim paths beyond the native limit.** `tuner-input.js` is a `ui/`
  file (UI isolate), so the calls it makes are UI-callable — unlike `claimPlot` (maps-only, likely
  inert). Two options for "grow as I want, any distance":
  - **`city.purchasePlot(loc)`** (`tuner-input.js:300`, CityPanel "PurchasePlot") — claims a plot **for a
    specific city**. City-attached; ❓ may cost gold and/or still be radius-capped (verify in-game).
  - **`WorldBuilder.MapPlots.setOwnership(playerID, loc)`** (`:96`) — raw plot ownership at ANY distance,
    free; ❓ may not attach the plot to a city (verify). `setOwnership(NO_PLAYER, loc)` = release.
  - Plot input: subclass **`ChoosePlotInterfaceMode`** (`interface-mode-choose-plot.js`) — it wires
    `WorldInput.setPlotSelectionHandler` and exits cleanly on Esc/right-click. (Also the M5 plot-click base.)
- ✅ **RESOLVED in-game (2026-05-27):** `EXPAND` does **NOT** work freely — it is gated on a pending
  growth (`city.Growth.isReadyToPlacePopulation`); `canStart(EXPAND).Plots` is empty otherwise. So the
  native picker yields exactly one claim per natural growth. Unlimited claim-anywhere would need
  `city.Growth.claimPlot` (unverified from the UI isolate) + a custom picker — see the M4.2-fix /
  "Decision pending" notes above.

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
