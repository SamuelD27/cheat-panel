# Discovery — F8 reliability, terrain visual refresh, unit teleport, minimap drag (2026-06-12)

Research round for the four user-reported items, done against the unpacked base UI source
(`…/CivilizationVII.app/Contents/Resources/Base/modules/`), the live logs, and (for the terrain
item) `strings` analysis of the game executable. Tags: **VERIFIED** (read in source/logs) vs
**INFERRED** (needs an in-game probe).

---

## A. F8 "works for me, not for others"

### Root causes (ranked)

1. **VERIFIED — InputActions UNIQUE collision rolls back the F8 row.** Live in our own logs
   (Database.log + Modding.log, 2026-06-12): with `local-cheat-panel` **and** the Workshop
   `sam-cheat-panel` both enabled, both insert ActionId `lcp-open-panel` →
   `UNIQUE constraint failed: InputActions.ActionId` → the engine **rolls back the losing mod's
   whole shell `<UpdateDatabase>`** → that user has NO F8 row, while the game-scope UIScripts
   (skull button, panel) still load fine. Exactly the reported symptom. Any player running two
   panel forks that share the ActionId reproduces this silently.
2. **VERIFIED mechanism — handler starvation.** `ContextManager.registerEngineInputHandler`
   handlers run **last** in the dispatch chain (`context-manager.js:583`), after the focused
   element, `Cursor.target`, and the current screen each get a chance to consume the event. The
   pause-menu view consumes **every** FINISH event (`view-pause-menu.js:42-59`).
3. **VERIFIED mechanism — our own allowsHotKeys gate.** The old dock code copied
   hotkey-manager's `InterfaceMode.allowsHotKeys()` gate; only `INTERFACEMODE_DEFAULT` and
   `INTERFACEMODE_UNIT_SELECTED` return true in the whole game — F8 silently no-op'ed in city
   view, diplomacy, placement modes, etc.
4. **INFERRED — per-user input-preferences file.** A per-user binding store exists engine-side
   (`core/config/Input.xml` "written to the settings file"; `Input.savePreferences/loadPreferences`).
   How saved prefs merge with a mod's default gesture is engine-internal; a user may also have
   manually rebound a base action onto F8 (no conflict-detection UI exists in options).

### Fix shipped (commit `6001de2`)

- Primary listener moved to **`engine.on('InputAction', (name, status, x, y))`** — the root of the
  UI input pipeline (`core/ui/input/action-handler.js:27`); fires before/independent of the
  ContextManager chain, cannot be starved.
- **allowsHotKeys gate dropped** — the panel toggle works in any interface mode.
- **Raw `window keydown` F8 fallback** (`e.code === 'F8' || e.keyCode === 119`) that acts **only**
  while `Input.getActionIdByName('lcp-open-panel')` is falsy (the rollback case), so the two paths
  can't both act; a 300 ms debounce in `togglePanel()` backstops any residual overlap.
  DOM key events verified present in this Gameface build (`screen-mp-chat.js:425` keyCode,
  `fxs-textbox.js:94` e.code) — but **window-level delivery of an unbound F8 is INFERRED**; the
  startup diagnostic (below) tells us which path is live.
- Startup diagnostic after 3 s (console.error → UI.log):
  `LCP: F8 wiring — input-action row PRESENT/MISSING (...)`.

### Follow-up for the Workshop copy

Give `sam-cheat-panel` a **different ActionId** (e.g. `sam-open-panel`) in its `input.xml` + dock
JS at the next Workshop sync, so the public copy can never collide with the local dev copy (or
any stale fork a subscriber still has installed).

### Useful APIs found (provenance)

| API | Where the base uses it |
|---|---|
| `engine.on('InputAction', (name, status, x, y))` | `core/ui/input/action-handler.js:27` |
| `Input.getActionIdByName(str)` → falsy if row missing | `editor-keyboard-mapping.js:145` |
| `Input.getGestureDisplayString(actionId, 0, InputDeviceType.Keyboard, InputContext.ALL)` | `editor-keyboard-mapping.js:299` |
| `Input.beginRecordingGestures` + `Input.bindAction` (programmatic rebind; needs the row) | `editor-keyboard-mapping.js:282,318` |

Base F-key defaults: F1 rankings, F5 quick-save, F6 quick-load, F9 civilopedia; **KEY_F8 is bound
to nothing** in any base module (`core/config/Input.xml`).

---

## B. Terrain paint: data applies, 3D mesh never redraws (mountain → flat)

- **VERIFIED:** no shipped JS contains any terrain-visual refresh. The tuner paints raw
  (`tuner-input.js:51-54`) with the same staleness. Full `engine.call` surface, `WorldUI.*`
  member list, and `WorldBuilder.*` usage all checked — nothing map-visual.
- **VERIFIED (binary):** terrain geometry is baked app-side (`TerrainBake*` pipeline) during load
  (`UIGameLoadingState.WaitingForVisualization`) — which is why save+reload always redraws.
- **VERIFIED (binary):** the executable binds two **unshipped** members on the same
  `WorldBuilderLibrary` we already call: **`WorldBuilder.startBlock()` / `endBlock()`**, paired
  with `GameCoreEvent::WorldBuilderBlockBegin/End`; the renderer has a runtime
  "Rebuild Terrain Cache" facility (ImGui debug panel, `EnableDebugPanels`) and a
  `MaterialVisualizer_TerrainEdit` shader — live terrain-edit support exists engine-side.
- **INFERRED (probe shipped, commit `ac0ed00`):** batching WB edits in `startBlock()…endBlock()`
  may signal the visualizer to rebuild. `paintPlot`/`placeNaturalWonder` now wrap their `set*`
  calls in `wbEdit()` (no-op when the bindings don't exist). One-time diagnostics log
  `typeof WorldBuilder.startBlock` and whether `TerrainTypeChanged` / `WorldBuilderBlockEnd`
  events fire.
- **Escalation if the probe fails:** (1) `EnableDebugPanels` in AppOptions.txt → in-game ImGui
  panel → Graphics/Terrain → "Rebuild Terrain Cache" (manual but would confirm the mechanism);
  (2) save+reload — the only guaranteed redraw.
- Bonus bindings found (untested): `WorldBuilder.MapPlots.setRevealed(pid, loc, bool)` and
  `setAllRevealed(pid, bool)` — a potential "reveal map" cheat; `setFeature` has an optional 3rd
  `DirectionTypes` argument.

---

## C. Unit teleport to an arbitrary plot

- **VERIFIED:** `Game.UnitOperations.sendRequest(unitID, "UNITOPERATION_TELEPORT_TO_CITY", {X,Y})`
  is a real UI-isolate instant teleport (identity/XP preserved) — but destinations are limited to
  `canStart(...).Plots` (capital cities; `interface-mode-teleport-to-city.js:11,47`).
- **VERIFIED (DB) / INFERRED (behavior):** a **hidden generic op `UNITOPERATION_TELEPORT_TO`**
  is registered (`base-standard/data/unit-operations.xml:34,113` — `VisibleInUI="false"`,
  "Travel to", icon `Action_TeleportTo.png`) with **zero** JS call sites. The transport is the
  proven sibling pattern, so the panel sends it and **reads the unit's location back** (polls) —
  honest confirmation either way. This is the primary path of `api.teleportUnitTo`.
- **VERIFIED fallback:** `UNITOPERATION_MOVE_TO` with
  `UnitOperationMoveModifiers.MOVE_IGNORE_UNEXPLORED_DESTINATION` (`world-input.js:405`,
  `interface-mode-move-to.js:93`) — pathed walk, not a teleport; with the global ∞-move toggle it
  reaches anything passable. Issued automatically (and reported in the status line) if the
  teleport doesn't land within ~0.8 s.
- **NOT used:** destroy+recreate (`DESTROY_ELEMENT`+`CREATE_ELEMENT`, tuner-proven) would reach
  truly arbitrary plots but loses XP/promotions/damage/state and changes the ComponentID — kept
  out unless the user asks for it.
- **For the record:** the engine's true primitive `Units.setLocation(unitID, loc)` exists only in
  the gameplay-script isolate (`age-transition-post-load.js:483,553`) — expected inert from UI
  (same lesson as `Units.create`).
- Note: `CREATE_ELEMENT` takes `Location:{x,y}`, while UnitOperations take top-level `X`/`Y` ints.

## D. Native minimap drag semantics (for reference)

The engine minimap (`panel-mini-map.js`) uses **no DOM mouse events**: it listens for
`'engine-input'` (`'mousebutton-left'`, status START→`Camera.lookAt(worldX, worldY)` snap;
DRAG/UPDATE→`Camera.panFocus({x:dx,y:dy}, false)` with world-space deltas from
`WorldUI.minimapToWorld({u,v})`), plus a window **capture-phase** listener for drag-end (FINISH
can be suppressed after drags). 1 hex = 64 world units (`plot-cursor.js:9`). Useful camera APIs:
`Camera.lookAt(x, y, {zoom, instantaneous})` (world coords!), `Camera.panFocus`,
`Camera.dragFocus(lastNorm, newNorm)`, `Camera.pickPlotFromPoint(px, py)`,
`Camera.setPreventMouseCameraMovement(bool)`, `WorldUI.getPlotLocation/getPlotAt/wrapWorldPosition`.

Our in-panel minimap kept its own canvas math and got **grab-to-scroll** drag (commit `779293f`)
instead of camera-follow drag — the wrap overflows and Gameface scrollbars are clumsy; plain
click still pans the camera. If camera-follow drag is wanted later, `Camera.panFocus` with
world-deltas (×64/hex) is the native recipe.
