# Local Cheat Panel — Build Status & Handoff

_Last updated: 2026-10-14. Read this first to resume work._

## ▶ Current round (2026-10-14): game updated to build 25516395; Creative paint (and City claim) clicks do nothing

| Report | Root cause (verified in base source + UI.log) | Fix | State |
|---|---|---|---|
| **Creative doesn't work** | Build 25516395 changed the engine-input handler contract from a boolean (`true` = pass-through) to `InputHandlerState` (`Active=0` pass-through, `Handled=1` consumed). `ContextManager` tests `result == InputHandlerState.Handled` (context-manager.js:602) with `.some()` across handlers. `InterfaceMode` is registered before `CameraController`/`PlotCursor`/`WorldInput` (root-game.js:162-168), so `LcpPlotMode.handleInput` returning `true` (`true == 1`) consumed every click and WorldInput never picked a plot. UI.log: `enterPaint … switchTo=true, cur=INTERFACEMODE_LCP_PAINT_TILE` but zero `commit:` breadcrumbs. The same base class drives City **Claim**, so that was dead too. | `lcp-plot-mode-base.js` returns `InputHandlerState.Active`/`.Handled` (mirrors the new interface-mode-acquire-tile.js:368). `InputHandlerState` is exported from `shared/imports.js`. | 🟡 committed, needs a **Reload UI** test |

Static checks on 25516395: the WorldBuilder `MapPlots.set{Terrain,Biome,Feature,Resource,Ownership}` bindings are still in the binary, and the Feature_NaturalWonders/ValidTerrains/ValidBiomes, Terrains, Biomes, Features and Resources tables still exist. These are not live-probed (the game was closed).
**Workshop twin `sam-cheat-panel` has the same bug.** It needs this one-file fix (`lcp-plot-mode-base.js` + `imports.js` byte-copy) in its next update, after a private dry run.

### Test (Reload UI)
1. Creative → Terrain → any terrain → Paint → click a land tile. Expect a yellow hover highlight, a **green/red flash** on click, and a `LCPD…commit:` line in UI.log.
2. Creative → Resource → any resource → Paint → click tiles. Paint several tiles in a row; the mode stays active.
3. Press **Esc** (or right-click, or the banner's Exit button). You should leave paint mode **without** the pause menu opening.
4. Cities → a city → **Claim** → click a tile → it joins the city.

### sam-cheat-panel Workshop twin (prepared, awaiting local test pass)
**2026-10-18:** The public Workshop copy has been prepared at `~/Library/Application Support/Civilization VII/Mods/sam-cheat-panel/` with:
- ✅ InputHandlerState fix copied (`lcp-plot-mode-base.js`, `imports.js`)
- ✅ Territory cheat removed (`api.js` uses only `city.purchasePlot`, not `WorldBuilder.MapPlots.setOwnership`)
- ✅ Dev-only modinfo cleaned (removed `lcp-twin-absent` criteria, `lcp-dev-*` group ids, LoadOrder 50 → 0, version bumped to 2)
- ✅ Database files collision-proof (InsertOrIgnore + Delete+Row already present in src/)
- ⏳ **Awaiting:** local-cheat-panel Reload UI test to pass. Once Creative paint/claim verify working, sam-cheat-panel is ready for smoke-test (enable only sam, restart, verify Modding.log clean) and Workshop upload.

---

## ▶ (prior) Current round (2026-09-14): game updated to build 24661151; panel wouldn't open; twin collision broke other mods

| Report | Root cause (verified) | Fix | State | Commit |
|---|---|---|---|---|
| **Panel can't open after the update** | NOT the update. `5664382` put backticks inside the injectPanelStyles CSS template literal, giving a module-wide SyntaxError at cheat-panel.js:169. `panel-lcp` was never defined, so the dock push threw at context-manager.js:113 and wedged the screen stack. A 6-auditor + 12-verifier drift audit found **no API drift** in 24661151. | Quotes instead of backticks, plus a warning comment. Every push is guarded with `Controls.isDefined('panel-lcp')`. | ✅ verified (panel opened after Reload UI) | `48a9c33` |
| **Skull button vanished after Reload UI** | `customElements.get('panel-sub-system-dock')` returns Controls' generic wrapper (no onInitialize, verified live). It is truthy, so it shadowed the `Controls.getDefinition` fallback. | Resolve via `Controls.getDefinition().createInstance` and accept only a class with onInitialize. Also decorate the already-initialized live dock, guarded against double-add. | ✅ verified (1 skull, 10 dock buttons) | `48a9c33` |
| **supercolors etc. "sometimes" missing in new games** | Whenever a configuration pass had BOTH local-cheat-panel and sam-cheat-panel in Target Mods: `UNIQUE constraint failed: InputActions.ActionId`, then a rollback of the whole shell/config DB, which removes supercolors' setup-parameters and jersey picker (9/9 correlation in Modding.log). | **Layer A**: `InsertOrIgnore` rows, gestures `Delete`+`Row`, LoadOrder 50, group ids `lcp-dev-*`. **Layer B**: criteria `<ModInUse inverse="1">sam-cheat-panel</ModInUse>`, so the dev copy is inert when the twin is in the pass. | 🟡 committed, needs a RESTART test (Layer B's `inverse` is runtime-unverified) | `8f68451`, `7ec72fd` |

### Restart test (modinfo changed, so Reload UI is not enough)
Key every check on whether `sam-cheat-panel` appears in that pass's Modding.log `Target Mods` list. The Mods.sqlite `Disabled` flag does NOT drive Target Mods.
1. **No-twin (normal dev state):** UI.log shows `LCP: F8 wiring — input-action row PRESENT`, the in-game `Target in-game actions` list includes `local-cheat-panel * lcp-dev-game`, and the skull, F8 and Map claim/paint all work. `sqlite3 -readonly Mods.sqlite` Criterion row for `lcp-twin-absent` has `Inverse=1`. **If the panel is gone while sam is absent from Target Mods, revert `7ec72fd` only.**
2. **Twin present (optional):** enable sam as well and restart. Expect no `UNIQUE constraint failed` in Database.log, no `Rollback Required`, and supercolors' setup picker present. Don't start a game until step 3 is confirmed.
3. In a game with sam in Target Mods, `lcp-dev-game` is absent (local inert) and only one panel exists.

Still open (found by the drift audit, pre-existing): Esc doesn't close the panel (only `sys-menu`); the minimap river enum is off by one (`RiverTypes` NO_RIVER=-1, MINOR=0, NAVIGABLE=1), which probably explains the open river bug; resource dot colours use Civ VI class names (CITY/EMPIRE show white); `sam-cheat-panel` needs the collision-proof `database/*.xml` in its next Workshop update (private dry run first).

---

## ▶ (prior) Current round (2026-07-22) — Steam-comment batch #1: Cities list + Restore-movement fixed; "missions" = engine wall

Three Steam-workshop comments, root-caused against the live 1.4.1 base source (3-agent workflow) + a
read-only live-tuner probe (game was running, port 4318). All JS/CSS-only → **Reload UI** (symlink deploy
is live). Constraint honored: purely additive, existing working paths untouched.

| Report | Root cause (verified) | Fix | State | Commit |
|---|---|---|---|---|
| **"6 cities, only first 4 shown"** | Pure CSS clip, NOT a data cap — `getCities()` returns all 6 (towns incl.). `.cheat-city-list`/`.cheat-unit-list` had `max-height:15rem; overflow-y:auto`, but a nested overflow div does NOT scroll in Gameface (only `<fxs-scrollable>` does) → ~4 tall rows fit, rest an unreachable dead window. Outer `fxs-scrollable` (`.subsystem-frame__content`) works. | Dropped the `max-height`+`overflow` cap (cheat-panel.js) → list flows at natural height, outer scroller handles overflow. Also un-clips long unit lists. | 🟡 implemented, NOT verified | `5664382` |
| **"restore movement doesn't work"** | `Units.restoreMovement` DOES restore MP from the isolate (verified infinite-move uses it). Defect = stale flag: it emits `UnitMovementPointsRestored` (no UI listens); flag un-greys only on `UnitMovementPointsChanged` (unit-flag-manager.js:164/277→unit-flags.js:491). A real move fires that; the manual [Move] fired nothing → unit stayed greyed + auto-skipped → "didn't work" even though it can move. | New `refreshUnitFlag()` re-emits `UnitMovementPointsChanged` after every manual restore (per-row/selected/all). 3 listeners all read-only → safe. Best-effort (cross-isolate delivery UNVERIFIED). | 🟡 implemented, NOT verified | `606dfad` |
| **"include Foundation & Leaders missions"** | These are account-level 2K **DNA online meta-progression** (LEGEND_PATH_FOUNDATION / CHALLENGE_CLASS_LEADER), server-authoritative, `Online.Metaprogression/Achievements/UserProfile` expose **only getters** (no grant/complete), and it lives in the SHELL, not the match sandbox the panel reaches. | **ENGINE WALL** — not implementable as a cheat. Adjacent reachable alt: grant in-match Legacy Path points via `Players.get(id).AdvancedStart`/`.LegacyPaths` (different feature). | ⛔ won't-do (wall) | — |

### Test plan (Reload UI — one pass)
1. **Cities:** open Cities with ≥6 settlements → scroll the tab (wheel or drag) → **all** cities reachable
   (previously stopped at ~4). Same for a long **Units** list.
2. **Restore movement:** move a unit until greyed → Units tab → its row **[Move]** (or **Restore Move**
   selected / bulk). Report: (a) does the panel row show full MP again? (b) does the **map flag un-grey**?
   (c) can you **move the unit again**? (a)=write, (b)=cross-isolate flag trigger, (c)=functional truth.
3. If (a)=yes but (b)=no, the restore works and only the flag trigger didn't cross isolates → next round
   finds another refresh path or discloses honestly.

---

## ▶ (prior) Current round (2026-07-13) — teleport REAL root cause = DISTANT LANDS (not fog); fix + Reveal Map committed; pending Reload-UI verify

Live tuner debugging (game running, ctx 65535) overturned the 2026-07-11 "fog" RCA. Controlled create
trials on a fully-revealed map isolated the true gate: **`CREATE_ELEMENT` cannot place a unit on a
Distant Lands tile** (`Players.get(owner).isDistantLands({x,y})===true`) — the Civ7 age-rule that units
can't exist on the far hemisphere this age. Home-continent tiles (isDistantLands=false, continent 19)
placed fine even far + formerly-fogged; foreign tiles (isDistantLands=true, continent 28) stayed blocked
even after `revealAllPlots` revealed them. The 2026-07-11 fog theory was a **confound** (the fogged
failures were also distant-lands; the revealed successes were also home-continent). **Fog does not block
create.** Also confirmed dead-ends: native `UNITOPERATION_TELEPORT_TO` is walled to Teleport-ability
units (founder Teleport=false → canStart=false); per-tile reveal APIs are silent no-ops from the isolate;
only `Visibility.revealAllPlots(p)` works (whole-map, reflects next frame). **⚠ Never call
`WorldBuilder.startBlock()` from the tuner/isolate — it froze the game this round (needs force-quit).**

**Fixes committed this round (JS-only → Reload UI):**
1. **Teleport distant-lands guard** (`api.js` teleportUnitTo STEP 1.5): if the clicked tile is Distant
   Lands, return `{ok:false, reason:'distant-lands'}` → Map tab shows *"Can't teleport to Distant Lands
   — pick a tile on your home continent."* instead of a silent "failed". Teleport works to ANY
   home-continent tile (create+detect+destroy all verified live). Removed the dead fog-reveal block from
   commit 21b2d01.
2. **🗺 Reveal Map cheat** (`api.revealEntireMap()` = `Visibility.revealAllPlots`; button in Map tab):
   uncovers the whole map (one-way; reload restores fog). Verified live. Does NOT unlock distant-lands
   teleport (separate engine wall).

**PENDING Reload-UI verify:** (a) teleport a unit to a HOME-continent tile → moves; (b) teleport to a
far/ocean (Distant Lands) tile → clear message, no silent fail; (c) 🗺 Reveal Map → whole map uncovers.
Note: the live game's map is already revealed (done during debugging with user consent). Other 3 bugs
(minimap sizing, river/desert paint, wonders) still pending — now fast to root-cause via the live tuner.

### (prior) 2026-07-11 — teleport fog RCA (SUPERSEDED — was a confound; real cause is Distant Lands above)

The 2026-07-07 diagnostic build paid off. User teleported a founder; UI.log `LCPD` breadcrumbs +
`net_message_debug.log` gave ground truth, and the game was left running so the **live tuner** (ctx
65535 in-match exposes `Game`/`GameplayMap`/`MapUnits`/`WorldBuilder`/`Visibility`) settled the RCA
with controlled experiments — no more guessing.

**Teleport RCA (PROVEN, 4 controlled live trials):** `CREATE_ELEMENT` silently seats **0 units on an
UNREVEALED (fog-of-war, `getRevealedState==0`) tile**, regardless of terrain or unit type.
- warrior @106/57 (rev=2, HILL) → ✅ placed
- founder @110/57 (rev=2, NAVIGABLE_RIVER) → ✅ placed  ← river terrain is NOT a blocker
- founder @78/36 (rev=0, NAVIGABLE_RIVER) → ❌ 0 units  ← the tile the panel actually used
- founder @72/2 (rev=0, FLAT) → ❌ 0 units
So every prior "teleport failed" was a click into unexplored fog. `MapUnits` was never the bug (it
reports correctly). The request DID reach GameCore (`net_message_debug.log` SEND+RECV) — a native
gameplay-layer placement rejection, not plumbing.

**Fix (committed 21b2d01):** `teleportUnitTo` reveals the destination before the create via
`Visibility.changeVisibilityCountForPlots(owner, 1, [plotIndex])` — signature confirmed live (a
wrong-arg-order probe logged `expected Array…argument 2` / `expected 3 args`, pinning it to
`(playerId, delta, plotIndexArray)`).

**PENDING live verify (do NOT claim fixed yet):** (a) confirm `Visibility` is defined in the
**panel-lcp isolate** (only confirmed in root-game ctx so far — if absent, the guarded reveal no-ops
and teleport still fails; needs an alternate reveal path); (b) reveal→create seats a unit end-to-end;
(c) user clicks Teleport to a fog tile → unit moves. Also: **2 test units were spawned during the
live experiment** (warrior @106/57, 2nd founder @110/57) — delete via DESTROY_ELEMENT next session.

**Bonus RCA — minimap drag (from the same log):** `drag.down cw=1542 vw=2041 ch=835 vh=700` → canvas
is NARROWER than its viewport (cw<vw) so horizontal pan is correctly clamped (nothing to scroll into);
vertical overflows so up/down works. The minimap bug is a **sizing** problem (viewport measured wider
than the canvas), not drag plumbing. River/desert-paint + wonder RCAs still pending their breadcrumbs
(user only tested teleport this round) — now live-probeable via the tuner.

### (prior) 2026-07-07 — DIAGNOSTIC build: self-readable UI.log breadcrumbs for 4 open bugs

User retested on **1.4.1** and reported four still-broken things: **(1)** minimap click-and-drag doesn't
pan; **(2)** teleport "failed"; **(3)** natural wonders can't be placed; **(4)** painting a navigable
river yields a **desert biome**. Every prior fix round for (1)/(2) was a blind guess — because
**panel-isolate `console.log`/`console.error` do NOT reach `UI.log`** (confirmed: the user's session left
only the *dock's* 2 `LCP:` lines; nothing from teleport/paint). So we could never see what actually
happened inside the panel.

**Observability breakthrough (this round):** the minimap draw-probe already proves ONE channel *does*
reach `UI.log` from this isolate — assigning a non-`<length>` string to `element.style.maxWidth` makes
the engine synchronously log `Trying to set "maxWidth" property to invalid value: <str>` (the
`PROBE_*` lines are right there in `UI.log`). Added `api.diag(str)` / `api.diagInit(doc)` (`api.js`) on
that channel (+ `console.error` as a second channel for the dock / interface-mode contexts), and
instrumented all four paths. **The developer reads the truth straight out of `UI.log`** —
`grep 'LCPD' UI.log` — so the user only has to test **once** and transcribe nothing. JS-only → Reload UI.

What each breadcrumb resolves (all tagged `LCPD~<n>~…` / `LCPD:<n>:…`):
| Bug | Breadcrumb | Discriminates |
|---|---|---|
| Teleport | `tp.env` (`typeof MapUnits`, dest/all counts), `tp.create`, `tp.result` | CREATE_ELEMENT never seats a unit **vs** `MapUnits` detection dead (unit made but undetected → duplicate left) **vs** seated off-target (`elsewhere`) |
| Minimap drag | `drag.down` (cw/vw/ch/vh), `drag.move` (fires at all?), `drag.pan` (req vs clamp) | mousedown not firing **vs** window-`mousemove` dead **vs** `clampPan` pinning because canvas ≤ viewport (no overflow) |
| Wonder | `enterPaint` (switchTo), `commit`, `nw:` (needTerr/biome vs terrNow/biomeNow, `typeof TerrainBuilder`, isNW) | mode switch fails **vs** clicks never reach `commitPlot` **vs** prep setter dropped **vs** `setFeature` walled with correct prep **vs** multi-tile |
| River→desert | `paint:` (terr, biomeWas→biome, feat, **isWater**, **riverType**) | engine coerced biome **vs** minimap mis-colours a NAV_RIVER land tile (colorForPlot only blues it when `isWater`) |

Adversarially reviewed the diff (2-lens workflow); 3 confirmed completeness gaps fixed before ship
(pre-write `biomeWas`, actual post-prep `terrNow/biomeNow` on wonders, one-shot `drag.move`), and a
regression trap avoided (raw `GameplayMap.isWater/getRiverType` inside `paintPlot`'s `try` would flip its
return to false on a throw → guarded in IIFEs). No behaviour changed; this build only *observes*.

### Test plan (Reload UI — one pass, then hand back; do NOT restart)
Do each once; order doesn't matter. Nothing to copy down — just do them and say "done":
1. **Minimap drag:** Map tab → left-press on the map and drag left/right and up/down.
2. **Teleport:** Map tab → pick a unit → **⚡ Teleport** (arm) → click a far **land** tile.
3. **Paint navigable river:** Creative tab → **Terrain** → pick *Navigable River* → **Paint at clicked
   tile** → click a **land** tile (note the green/red flash).
4. **Place a natural wonder:** Creative tab → **Wonder** → pick a **single-tile** wonder (NOT one marked
   "not placeable") → Paint → click a land tile.

Then tell me it's done — I read `UI.log` (`LCPD` lines) and root-cause all four, no guessing.
Next round = the actual fixes, targeted by that evidence.

## ▶ Current round (2026-06-25) — GAME PATCHED to 1.4.1; teleport delete-step fixed (UNITCOMMAND_DELETE → DESTROY_ELEMENT)

User retested after a **game update landed (1.4.0 build 23245653 → 1.4.1 build 22163 / change 1267347)**:
teleport "still doesn't work." Root-caused **live via the tuner** (port 4318 was up this time): the
destroy+recreate teleport's CREATE step works and the new unit is detected, but the delete-the-original
step was silently rejected — `canStart("UNITCOMMAND_DELETE")` now returns `{Success:false}` on 1.4.1, so
the original was never removed → the unit was **duplicated, not moved**. (The same break silently disabled
the per-row unit Delete too.) `DESTROY_ELEMENT` — the tuner's lower-level element removal — still works
(verified live: throwaway unit created then removed, plot confirmed empty).

**Fix (JS-only → Reload UI):** `deleteUnit()` (`api.js`) now uses `Game.PlayerOperations.sendRequest(owner,
'DESTROY_ELEMENT', {Kind:'UNIT', Owner, LocalID})` instead of `UNITCOMMAND_DELETE`. One change fixes BOTH
teleport (the original is now removed → a true move) and the per-row unit Delete. Teleport's
create / detect / destroy primitives were each verified individually on the live 1.4.1 game via the tuner.

⚠ **Docs now stale:** parent `Civ7/CLAUDE.md` + `docs/*` still say target build 23245653 / 1.4.0. The live
game is **1.4.1 (build 22163, change 1267347)**. Re-run `extract_types` / re-verify patch-sensitive API when
convenient; nothing else in this mod is known-broken by 1.4.1 (Units.*, CREATE_ELEMENT, MapUnits, Camera,
Players all confirmed present + working live).

### Test plan (Reload UI)
1. **Teleport MOVES (not duplicates):** Map tab → pick your unit → **⚡ Teleport** → click a far land tile.
   The unit should be at the destination **and gone from its old tile** (one unit, relocated). Status:
   `Teleported ✓ … fresh unit`. (Watch specifically that there is NOT a leftover copy at the start tile.)
2. **Per-row Delete** (Units tab) also works again — same `DESTROY_ELEMENT` fix.
3. **Minimap pan / ⤢ Fit** as in the 2026-06-23 plan below (unchanged this round).

## ▶ Current round (2026-06-23) — minimap pan + teleport REBUILT on proven engine paths

User retested (2026-06-23): **(1)** minimap "still not navigable by click-and-drag"; **(2)** teleport
"doesn't work (engine rejected)" — the key probe we'd awaited since 2026-06-12. Both root-caused with an
adversarially-verified investigation workflow, then rebuilt on PROVEN APIs. All **JS-only → Reload UI**.

| Report | Root cause (verified) | Fix | State |
|---|---|---|---|
| **Teleport engine-rejected** | `UNITOPERATION_TELEPORT_TO` is a hidden op with **ZERO JS call sites** in the whole shipped game (`unit-operations.xml:34,:113`, VisibleInUI=false) → no validated UI entry point → the gameplay layer silently drops the isolate `sendRequest`. The "rejected — move order issued" the user saw was our own MOVE_TO fallback. Confirmed engine wall for that op. | Rewrote `teleportUnitTo` (`api.js`) as **DESTROY + RECREATE**: `CREATE_ELEMENT` a same-type unit at the destination (the M3-verified Duplicate/tuner path), poll the dest plot for the new unit, then `deleteUnit(original)` via the proven `UNITCOMMAND_DELETE`. Create-FIRST so a failed create never loses the unit. **Trade-off:** fresh same-type unit — XP/promotions/name/HP/army NOT kept (disclosed in a standing note + the success line). | 🟡 implemented, NOT verified |
| **Minimap won't pan left/right** | Panel is **78rem** wide; `fitZoomToWidth` auto-fit the canvas to the panel WIDTH → canvas a few px narrower than the viewport → `clampPan` pinned panX to centre → horizontal drag discarded. (Vertical worked: canvas ~659px tall > the fixed 416px viewport — exactly "can only zoom, not go left/right".) | Replaced with **fit-to-OVERFLOW** default (`fitZoomDefault`): map opens modestly larger than the viewport in BOTH axes so drag has range immediately; opens **centred on the capital** (`centerPanOn`); added a **⤢ Fit** button (`fitMapZoom`, true both-axes overview). Drag plumbing unchanged (it was already sound — same window-listener pattern as the working header drag). | 🟡 implemented, NOT verified |

**Adversarial review (3-lens workflow) caught + fixed a BLOCKER:** the armed button + the old `_tpSeq`
supersession let a fast double-click strand the first-created unit as a permanent duplicate. Fixed with a
one-at-a-time `tpInFlight` guard (UI) + removed the supersession bail (`api.js`) so each create+delete chain
always runs to completion. Also fixed: ⤢ now fits both axes (honest label), full teleport reason-map
strings, fuller disclosure note.

⚠ **Known edge (untested):** if `CREATE_ELEMENT` ever seats the unit on a different plot than requested,
`findNew` (dest-plot scan) would miss it → reported "failed", off-plot unit left. M3 proves CREATE honors
`Location`, so low risk — watch for it during the test.

### Test plan (Reload UI, then in order)
1. **Teleport works:** Map tab → pick a unit chip (or `◎ World-selected` with a unit selected in-world) →
   **⚡ Teleport** to arm → click a far **land** tile. Status: `Teleported ✓ … fresh unit`. The unit appears
   there (camera pans), the OLD tile is empty. (Fresh same-type unit — XP/promotions gone, per the note.)
2. **Teleport guards:** click **water** for a land unit / a **mountain** / an **occupied** tile → a clear
   refusal, no unit created. Double-click two tiles fast → 2nd says "already in progress", **no duplicate** left.
3. **Minimap pans left/right:** open Map tab → it opens zoomed-in, centred on your capital → **left-drag** → it
   moves in BOTH axes (grab cursor, tooltip hidden). A plain click (<5px) still pans the camera / teleports if armed.
4. **Fit:** click **⤢** → the whole map fits the panel (overview). Then zoom **−/+** and drag again.

## ▶ Current round (2026-06-20) — minimap pan rebuilt + teleport rebuilt in-panel

User retested and reported: **(1)** the minimap still "can only zoom, not go left and right";
**(2)** "teleport feature isn't there" (chose **No teleport button at all**); **(3)** keep new features
**inside the UI, not outside**. For unit selection they chose **both** (in-panel list + world-selected).
All **JS-only (`tab-map.js`) → Reload UI**, no restart. Deploy symlink confirmed current.

| Report | Root cause | Fix | State |
|---|---|---|---|
| **Minimap won't pan left/right** | The old drag scrolled an `overflow:auto` box via `scrollLeft`, but `fitZoomToWidth` sizes the canvas to *fit* the panel width → zero horizontal overflow → nothing to scroll; Gameface `scrollLeft` is unreliable too. | Replaced with **transform-pan**: canvas is `position:absolute` in an `overflow:hidden` **viewport**, moved by `transform:translate(panX,panY)`; drag updates pan, `clampPan()` keeps it on-screen. Full 2-axis pan; zoom (−/+) zooms about the viewport centre. | 🟡 implemented, NOT verified |
| **No teleport button at all** | Deploy is current (md5-matched, has the prominent button) → the running session predated the `ad4c545` reload (old easy-to-miss chip). | Rebuilt prominent **⚡ Teleport** toggle + an **in-panel unit picker** (`◎ World-selected` chip + one chip per unit; `resolveTpUnit()` re-resolves by ComponentID, falls back to world-selected = **"both"**). Defensive guards so no render-time API call can blank the section. | 🟡 implemented, NOT verified |
| **Keep it inside the UI** | — | Viewport `overflow:hidden` clips the canvas; unit picker is inline; tooltip clamped inside the viewport. Nothing renders outside the frame. | 🟡 implemented, NOT verified |

**Adversarial review (3-lens workflow) caught + fixed:** `sizeViewport()` was shrinking the viewport to
the canvas height, which made `ch<=vh` always true in `clampPan()` → **vertical pan dead** for
wide-and-short maps + a height jump mid-zoom. Fix: viewport keeps a **constant height** (`VIEW_CAP_PX`,
26rem); `clampPan()` centres a short map in the dark letterbox band. (Removed `sizeViewport()` entirely.)

⚠ **Still unverified engine probe:** true teleport uses `UNITOPERATION_TELEPORT_TO` (never confirmed to
validate in this build). If the engine rejects it, the unit **walks** (MOVE_TO fallback) and the status
line says so. The **far-land teleport message is the key probe** — report exactly what it says.

### Test plan (Reload UI, then in order)
1. **Teleport visible:** Map tab → a **── Teleport unit ──** divider + a wide **⚡ Teleport: OFF** button,
   then a **Unit to teleport** list (a `◎ World-selected` chip + one chip per your units). All clearly
   inside the panel.
2. **Pick + teleport (in-panel):** click a unit chip (it highlights; status shows `[picked]`), click
   **⚡ Teleport** to arm, then click a **far land tile on the minimap**. Status reports `Teleported ✓` /
   `Arrived (walked)` / `rejected — move order issued` / `failed`. **Quote the far-land message.**
3. **Teleport (world-selected):** leave it on `◎ World-selected`, select a unit in the world, arm, click
   a minimap tile — same flow. (Both paths must work.)
4. **Pan:** zoom **in** (+) a few times, then **left-drag the minimap** → it moves under the cursor in
   **both** axes (grab cursor, tooltip hidden), and can't be dragged off the box. A plain click (<5px)
   still pans the real camera / teleports if armed.
5. **Inside the UI:** the minimap, tooltip, and unit list all stay **within the panel** — nothing spills
   past the frame edges.

## ▶ Current round (2026-06-13) — in-game feedback on the 2026-06-12 items; 3 Map-tab fixes + terrain wall confirmed

User tested the 2026-06-12 round. Reports + fixes (all **JS-only → Reload UI**, no restart). F8 not
re-reported (assumed OK or untested — confirm). Files: `tab-map.js`, `paint-tile-mode.js`.

| Report | Diagnosis | Fix | State |
|---|---|---|---|
| **Minimap drag can't pan left/right** (only zoom worked) | `canvasWrap` used `width:fit-content`, so the box hugged the canvas → zero internal overflow → `overflow:auto` never engaged → `scrollLeft` stayed 0. A canvas wider than the panel also spilled past the content edge. | `canvasWrap` → `box-sizing:border-box; width:100%` (fixed-width scroll box). Drag now moves `scrollLeft/Top`. Click-to-pan and the <5px click/drag split are unchanged. | 🟡 implemented, NOT verified |
| **Legend "cut off too far to the right"** | Legend chips were `flex:0 0 33%` + `white-space:nowrap`; a wide label (e.g. "Navigable") overflowed its rigid 33% basis past the panel's right edge, clipping the row. The fit-content canvas overflow compounded it. | Chips → `flex:0 1 auto` (content-sized, wrap as many-per-line as fit); legend font 1.2→1.0rem, `gap`, `max-width:100%`; hint `white-space:normal`. | 🟡 implemented, NOT verified |
| **"I don't see the teleport option"** | The ⚡ Teleport control was a small `.lcp-row-btn` chip sitting immediately beside the Cities/Resources/Me filter toggles — same style, so it read as just another filter and got overlooked. (It WAS rendering — the canvas/legend below it render fine, proving `refreshTpUi()` didn't throw.) | Promoted to a full-width labeled `.lcp-toggle-btn` under its own **── Teleport unit ──** section divider; button text now shows state (`⚡ Teleport: OFF — click to arm` / `ARMED — click a minimap tile`). | 🟡 implemented, NOT verified |
| **Terrain paint "still doesn't change the UI"** (the startBlock/endBlock probe failed) | **CONFIRMED ENGINE WALL (3rd time).** Re-audited base JS: `WorldBuilder` is only ever `WorldBuilder.MapPlots.set*` (6 setters, 20 call sites) — no rebuild/refresh anywhere; `TerrainBuilder` is map-gen-only (inert from the UI isolate); the probed `startBlock/endBlock` bindings do nothing. Camera-pan/end-turn do NOT redraw it either. **Only save+reload rebuilds the mesh.** | No code path can force the redraw — made the in-game text honest instead (paint banner hintNote + header comment no longer claim camera-pan/end-turn works; both now say "data IS applied, save & reload to see it"). The data write + green/red read-back flash are unchanged. | ✅ honest messaging; **engine-limited, not fixable from JS** |

### Test plan (Reload UI, then in order)
1. **Teleport visible:** Map tab → between the Cities/Resources/Me filter row and the minimap there's now
   a **── Teleport unit ──** divider and a wide button reading **⚡ Teleport: OFF — click to arm**. Click
   it → it turns active and reads **ARMED — click a minimap tile**, message shows your selected unit.
2. **Teleport works:** with a unit selected, arm it, click a far land tile on the minimap → status reports
   `Teleported ✓` / `Arrived (walked)` / `rejected — move order issued` / `failed`. **Report the far-land
   message** (still the key probe for whether `UNITOPERATION_TELEPORT_TO` validates).
3. **Drag-pan:** zoom **in** (+) until the map overflows its box → left-drag → the map scrolls under the
   cursor (grab cursor, tooltip hidden). A plain click (<5px) still pans the camera / teleports if armed.
4. **Legend:** the legend row below the map is fully visible (no right-edge clipping) and wraps cleanly.
5. **Terrain (expectation reset):** painting still won't visibly change the mesh live — that's a confirmed
   engine limit. Paint a tile (green flash = data applied), then **save + reload** and confirm the change
   shows after the reload. The banner now states this so it no longer reads as "broken".

## ▶ Round (2026-06-12) — 4 user-reported items, all implemented & deployed, NOT yet verified

All four are **JS-only → in-game `~` → UI → Reload UI** (no restart needed). Research notes with
provenance in `docs/discovery-f8-terrain-teleport.md`. Symlink deploy confirmed live.

| Item | Scope | State | Commit |
|---|---|---|---|
| **F8 reliability** | "F8 works for me, not for some players." Root cause VERIFIED in our own logs: a second mod inserting the same `InputActions.ActionId` (`lcp-open-panel` — e.g. the Workshop sam copy, or any fork) → `UNIQUE constraint failed` → the whole shell `UpdateDatabase` rolls back → **no F8 row for that user** (skull button unaffected). Also: the old ContextManager handler ran LAST (pause menu eats every FINISH), and our own `allowsHotKeys()` gate killed F8 outside default/unit-selected modes. Fix: `engine.on('InputAction')` primary path (unstarvable) + gate dropped + raw `keydown` F8 fallback active only while `Input.getActionIdByName` says the row is missing + 300ms debounce. Startup diagnostic in UI.log: `LCP: F8 wiring — input-action row PRESENT/MISSING`. | 🟡 implemented, NOT verified | `6001de2` |
| **Minimap drag** | Left-drag on the Map-tab minimap grabs and scrolls it inside its box (no more scrollbar fishing); <5px press is still a click = camera pan; tooltip hides while dragging. | 🟡 implemented, NOT verified | `779293f` |
| **Teleport via minimap** | New **⚡ Teleport** arm-toggle on the Map tab: arm → select your unit in the world → click a destination tile **on the minimap** → unit teleports (identity/XP kept). Primary: hidden `UNITOPERATION_TELEPORT_TO` (DB-registered, `VisibleInUI=false`, zero base call sites — **unverified engine validation**); honest location read-back by polling; auto-fallback to a normal `MOVE_TO` walk (reported in the status line, never silent). Destination pre-checked with the Duplicate plot rules. | 🟡 implemented, NOT verified — **the TELEPORT_TO send is the key probe** | `4ee64c9` |
| **Terrain paint visual refresh** | User-confirmed: mountain→flat applies to gameplay but the 3D mesh NEVER redraws (not even camera-pan/end-turn — old hint text was wrong, now fixed). No refresh exists in any shipped JS (binary-verified); probe shipped: every paint now runs inside **`WorldBuilder.startBlock()`/`endBlock()`** (unshipped bindings found in the executable, paired with `WorldBuilderBlockBegin/End` engine events). Diagnostics log whether the bindings exist + whether `TerrainTypeChanged`/`WorldBuilderBlockEnd` fire. If inert: `EnableDebugPanels` → "Rebuild Terrain Cache", or save+reload (guaranteed). | 🟡 implemented, NOT verified — **probe** | `ac0ed00` |

**Post-review hardening (`562fcc8`):** an adversarial review pass confirmed + fixed 3 issues:
(a) re-entering paint/claim mode while it's already active (newly reachable — F8 now works in any
mode) silently kept the OLD type/city because base `switchTo()` no-ops on a same-mode call —
`enterPaintMode`/`enterClaimMode` now `switchToDefault()` first and honor the return value;
(b) repeat teleport clicks now supersede the previous in-flight poll chain (no stale `MOVE_TO`
fallback / status overwrite); (c) a teleport result arriving after the Map tab re-rendered or the
panel closed no longer redraws the detached canvas (render-generation + liveness guard).

### Test plan (Reload UI, then in order)
1. **F8:** press F8 in normal world view → panel toggles. Then press F8 **inside city view /
   placement mode / with the pause menu open-then-closed** — it should now toggle everywhere.
   Check UI.log for `LCP: F8 wiring — input-action row PRESENT` (with only local-cheat-panel
   enabled it should be PRESENT; if you enable the sam copy too, expect MISSING + the raw
   fallback — report whether F8 still works in that state, that's the fallback probe).
2. **Minimap drag:** Map tab → zoom in until the map overflows its box → left-drag: the map pans
   under the cursor (grabbing cursor, no tooltip). A plain click still pans the real camera.
3. **Teleport:** select one of your units in the world → Map tab → click **⚡ Teleport** (arms,
   status shows the unit) → click a far tile on the minimap. Status line reports one of:
   `Teleported ✓` (then camera pans there + triangle moves) / `rejected — move order issued` /
   `failed`. Try: far land tile, water tile (should refuse for a land unit), mountain (refuse),
   occupied tile (refuse). **Report which message you get for the far-land case** — if TELEPORT_TO
   is rejected, the next iteration wires the destroy+recreate variant behind a confirm.
4. **Terrain paint:** Creative tab → Terrain → pick Plains/Grass → paint a MOUNTAIN tile. Green
   flash = data applied. **Watch whether the mountain mesh now actually flattens** (the
   startBlock/endBlock probe). Check UI.log for `LCP: wb-probe: typeof WorldBuilder.startBlock =`
   and any `TerrainTypeChanged` / `WorldBuilderBlockEnd` lines — quote them in your report. If the
   mesh stays, save+reload and confirm it redraws then (it should — visuals rebuild on load).

### Workshop follow-up (when this round is verified)
Sync to `sam-cheat-panel` and **change its ActionId** to something unique (e.g. `sam-open-panel`,
in its `input.xml` + dock JS) so the public copy can never collide with the dev copy or stale
forks; bump modinfo version; private-visibility dry run first (hard rule #3).

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
| **M6-center** | Panel pinned `left-0` looked lopsided after widening → `centerPanel()` measures laid-out width 1 frame after attach and centers it (drag still works from there) | 🟡 **implemented (JS-only Reload UI), NOT yet verified** | `14aa071` |
| **M7** | **Map Preview overhaul (in-panel only):** snapshot now carries per-resource `type`+`name` and per-plot `feat`/`featName` (NW identity); **feature shading** (forest/jungle/reef/ice/volcano…), **bigger default zoom (10px)**, **hover tooltip** (terrain/biome/feature/resource/coords), **click-to-pan** the real camera (`api.lookAtPlot`, read-only), and a **multi-select spotlight filter** — pick resources / natural wonders present on the map and every non-matching tile dims (matches ringed gold). Pure canvas + read-only reads; no vision granted, no save changes. Map **Paint** section kept but relabeled "experimental" (on standby) | 🟡 **implemented (JS-only Reload UI), NOT yet verified** | `28fd9f6` |
| **M8** | Map-tab feedback: (a) spotlight/legend swatches drawn as styled `<span>` (background-color / CSS-border triangle) instead of font glyphs `■ ● ▲ ▬` (those rendered as white/green tofu boxes); (b) **legend compressed** 3→2 lines; (c) **Map Paint moved to a new CREATIVE tab** (`tab-creative.js`) so the minimap reclaims the freed space; (d) **bigger map** — default zoom 10→14px, max zoom 24→28, canvas max-height 24→34rem | ✅ **verified in-game (2026-05-30)** — but feedback: panel resized per tab, map didn't fill width, legend/filter fonts too small | `d7cecdb` |
| **M8-fix** | (a) **Frame size lock actually works now**: the `.cheat-frame` host carried the `items-center` utility, so the interior `fxs-vslot` was centered & **shrank to tab content** (why the frame + tab bar resized per tab) — override with `align-items:stretch` + force interior/content `width:100%`. (b) **Map fills width**: canvas wrap `width:fit-content` (no dark band beside the map) + default zoom 14→**18** (max 28→**34**), wrap max-height 34→40rem. (c) **Bigger fonts**: legend 0.68→0.82rem (`white-space:nowrap` keeps each line grouped), filter/zoom buttons 0.78→0.92rem | 🟡 **implemented (JS-only → Reload UI), NOT yet verified** | `39339f8` |
| **M8-fix3** | (a) **Legend → 3-per-line chip grid** (flex-wrap, each chip `flex:0 0 33%`) instead of one item per line; hint on its own line. (b) **Slightly bigger fonts** across all tabs (row labels/buttons 0.75–0.85→0.82–0.92rem, sections, list-empty; map legend/status/spotlight bumped). (c) **Map auto-fits panel width** (`fitZoomToWidth` from `container.clientWidth`, until the user manually zooms) so smaller maps stop leaving empty space beside the minimap | 🟡 **implemented (JS-only → Reload UI), NOT yet verified** | `33b7db1`+`83c79ab` |
| **M9** | **Minimap precision** — user chose *hexagons + sharper render* (keeps reveal-all). Replace offset-squares with true **pointy-top hexagons** (circumradius `S=tile/√3`, row spacing `1.5·S`, odd-row +½ offset — same model as engine `panel-mini-map.js`, so positions stay engine-accurate); **supersample** the canvas (SS=2 below 16px tiles, smoothing on) for crisp edges; **nearest-hex-center** hover/click pick instead of square `floor()`. Rivers→lower-edge chord, NW/resource→dots, cities→filled hex, units→triangle | 🟡 **implemented (JS-only → Reload UI), NOT yet verified** | `773a219` |
| **M6** | Remaining polish: steppers, drag-persist, conflict-detect, banners, docs | ⬜ pending | — |

## ▶ Current state (2026-06-02) — Items 1–3; Creative tab in progress; Workshop synced

This session worked three items on top of the M9 map-crash fix (which is verified & shipped to the
public Workshop copy). Full per-item analysis in `docs/discovery-{claim,exit,creative}.md`.

| Item | Scope | State | Commit |
|---|---|---|---|
| **M9 map fix** | Map-tab native crash on large maps (batch the canvas draw) | ✅ verified & shipped to Workshop (sam v2) | `9ee2f64` etc. |
| **Item 1 — claim → growth** | Make cheat-claimed tiles actually growable/buildable | ⛔ **ENGINE WALL** — out-of-radius workability is hardcoded in the C++ core (the growth domain has no JS setter, no modifier widens it). `purchasePlot` gives ownership but not workability. **Reverted claim to the pre-Item-1 `setOwnership` version** per user. See `docs/discovery-claim.md`. | reverted to `5b07ac6` |
| **Item 2 — clean plot-mode exit** | Esc/right-click/✕ cleanly exit claim/paint modes (was opening pause menu) | ✅ **done & verified in-game.** New shared base `lcp-plot-mode-base.js` (`LcpPlotMode`): `handleInput` swallows cancel + the REQUIRED `reset()` (its absence was the real bug). claim/paint extend it. See `docs/discovery-exit.md` + memory `civ7-custom-interface-mode-gotchas`. | `ab21194` |
| **Creative #1 — Resource DELETE + read-back** | "(Clear / remove resource)" entry + honest green/red flash (paintPlot re-reads the plot) | ✅ **done & verified in-game** | `cf1ae02` |
| **Creative #2 — Natural Wonders** | New **Wonder** category (single-tile prep-then-place: set terrain+biome → setFeature → confirm via `isNaturalWonder`); NWs filtered out of the generic Feature list | 🟡 **partial** — single-tile NW placement still gets gated (waterfall/neighbor TypeTags); user: "not working perfectly". Feature-list filter works. **Multi-tile NW = infeasible** (only map-gen-only `TerrainBuilder` anchors shapes). See `docs/discovery-creative.md`. | `fbd4503` |

**Workshop copy synced (2026-06-02):** `…\Mods\sam-cheat-panel\` updated to **version 3** with Item 2 +
both Creative milestones. **Territory cheat kept OUT** (its `claimPlotForCity` uses `purchasePlot`, not
`setOwnership` — verified: `setOwnership` only appears in a comment). **NOT yet uploaded to the Workshop**
— that's the manual Civ7 SDK Mod Uploader step (see `docs/workshop-publishing.md`); the user should test
the sam copy in-game first, especially since NW is partial.

### ▶ When resuming (next actions)
1. **Decide the Natural Wonder feature:** keep the Wonder category (single-tile, partial) or drop it.
   If keeping: investigate the **WATERFALL** gate (Gullfoss/Iguazu) and add **neighbor prep** for Uluru
   (`ADJACENTTOSAMEBIOME` + `NOTADJACENTMOUNTAIN`). Multi-tile is a dead end — don't pursue.
2. **Optional Creative polish** (audit `docs/discovery-creative.md` §B2/B4): configurable resource
   amount, group resources by class, dedupe the category maps, fix stale doc comments.
3. **Workshop publish** when satisfied: test `sam-cheat-panel` in-game (disable `local-cheat-panel`
   first), then upload via the SDK Mod Uploader. Bump the sam modinfo version each upload.

**New shared infra this session:** `src/ui/cheat-panel/lcp-plot-mode-base.js` — every plot-selection mode
(claim, paint, future tools) extends it for the clean exit + exit banner.

---

## (history) Earlier round: Reload UI, verify M9 (hex minimap) + M8-fix3 (fonts/width/legend)

All **JS/CSS-only** (`cheat-panel.js` + `tab-map.js`) → in-game `~` → UI → **Reload UI** (no restart).

### M9 test plan (Reload UI) — hex minimap
1. **Map tab → minimap is drawn as HEXAGONS now** (pointy-top, interlocking rows), not squares, and the
   edges look **crisp / anti-aliased** rather than blocky.
2. **Hover precision:** moving the cursor over a tile shows the tooltip for the **correct** plot (the
   nearest-hex-center pick should feel accurate even near the staggered row boundaries). **Click** still
   pans the real camera to that exact tile.
3. Cities = filled hex in civ color (capital = white outline), units = triangle, resources/wonders =
   dots, rivers = a thin chord near the tile's lower edge. Spotlight dim/ring still works on hexes.
4. Zoom −/+ (2–34), ↻, and Cities/Resources/Me toggles still work. **Open ❓:** if hover/pan feels off by
   one row near the very top/bottom edges, say so — the nearest-center search window may need widening.

### M8-fix3 test plan (Reload UI)
1. **Frame no longer resizes per tab.** Player → Units → Cities → Map → Creative → Research should stay
   the **same width/height**; long tabs scroll internally.
2. **Map fills the width** (auto-fit zoom) — no dark band beside the minimap on smaller maps.
3. **Bigger fonts** everywhere; legend is a **3-per-line chip grid**, hint on its own line below.

### M8 test plan (after restart)
1. **Map tab → spotlight filter:** the white/green tofu squares next to resource names are gone —
   each chip now shows a small **colored swatch** matching the resource class. Legend below the map
   is **2 compact lines** with the same clean swatches (square / river bar / unit triangle).
2. **Bigger minimap:** the map now defaults to a larger zoom (14px) and should fill the panel width
   much better — the big black band on the right should be largely gone. Zoom −/+ (range 2–28) and ↻
   still work; hover tooltip + click-to-pan unchanged.
3. **New CREATIVE tab** (between Map and Research): it holds the old **Map Paint** UI (Terrain /
   Feature / Resource / Biome → pick a type → [Paint at clicked tile]). The Map tab no longer has the
   paint section. Paint itself is still **experimental/standby** — open the tab, confirm it renders the
   category buttons + type list, but you don't have to actually paint.
4. Other tabs (Player / Units / Cities / Research) unchanged; tab switching, drag, close, F8/dock all
   still work with 6 tabs in the bar.

### (verified 2026-05-30) M7 + M6-center test plan
1. **Open panel** → it should appear **horizontally centered** (no more big empty band on the right).
2. **Map tab → Map Preview:** minimap is larger/clearer now; **feature shading** visible (forests/jungle
   darker green, reef teal, ice white, etc.). Hover a tile → **tooltip** shows coords / terrain / biome /
   feature(or wonder) / resource. **Click a tile** → the real game camera pans there.
3. **Spotlight filter** (below the preview): a list of the **resources** and **natural wonders** actually
   present on the map. Click one or several → every other tile **dims**, matches are **ringed gold**, and
   the status line shows the matched-tile count. **Clear** resets. (E.g. select "Llamas" → only Llama
   tiles stay bright.)
4. Cities / Resources / Me toggles and zoom −/+ / ↻ still work; civ colors correct (not white/black).
5. **Map Paint** is now labeled "experimental" and is **on standby** — don't test it (known exit trap,
   recorded in `Minor_todos.md` #3).

**Open ❓ to confirm:** hover/click plot mapping is approximate near hex-offset rows — if the tooltip/pan
feels off by one row/column at high zoom, say so and I'll refine the inverse mapping.

## ▶ (resolved) Latest in-game feedback (2026-05-29) — restyle good; width + paint-exit fixes

- ✅ **Restyle approved** ("style is good, keep it"). Panel now opens (the `4424a2a` backtick fix).
- **Width too narrow → fixed (`953c319`):** locked width `26rem` → `78rem` (~3×), `max-width:96vw` guard.
- **Paint mode "trapped" → fixed (this commit):** user entered the Map-tab **paint** picker (clicked the
  **Feature** category, not a filter), painted tiles (green flash = `api.paintPlot` succeeded), but felt
  trapped. Confirmed via Q: **Esc/right-click DOES exit** (same `ChoosePlotInterfaceMode` base as the
  verified Claim mode) — they just **didn't know how to exit** (no on-screen cue). Fix: `paint-tile-mode.js`
  now shows a fixed top-center **hint banner** while painting ("🖌 PAINT MODE — Cat = TYPE · Click tiles ·
  Esc or right-click to exit · terrain redraws after camera move / next turn"), created in `decorate()`,
  removed in `undecorate()`, `pointer-events:none` so it never eats map clicks. _The paint itself works;
  the terrain just doesn't visibly redraw until a camera-pan/end-turn — engine limitation, now stated in
  the banner._

## ▶ (resolved) Reload UI, verify M6-restyle + M5.x-fix2 — restyle approved 2026-05-29

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
