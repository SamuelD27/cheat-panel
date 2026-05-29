# Minor / Secondary TODOs

Small polish items deferred until the panel's core features all work. Nothing here blocks a milestone;
revisit during **M6 (polish)** or whenever a related file is open anyway.

---

## 1. Infinite Movement — units spawned while the toggle is ON don't benefit until OFF/ON
- **Observed (M3, 2026-05-27):** with the global ∞-move toggle already ON, a unit that spawns
  afterward (built/created mid-turn) doesn't get free movement until the toggle is switched OFF then
  ON again (or the next turn starts).
- **Cause:** `shared/infinite-move.js` only restores movement on two events — `UnitMoveComplete`
  (after a unit moves) and `PlayerTurnActivated` (turn start). A brand-new unit hasn't moved, so
  neither fires for it until next turn. Toggling OFF/ON re-runs `restoreAllLocal()`, which iterates
  *all* current units and thus catches the new one.
- **Likely fix:** also restore on a unit-added engine event (something like `UnitAddedToMap`),
  guarded by `globalInfinite` and `owner === localPlayerID`. **Not done now** because it needs the
  exact event name + payload shape verified against the base source before wiring a new listener —
  more than a quick, safe change, and we don't want to risk the working toggle.
- **Severity:** cosmetic / minor (user explicitly de-prioritized).

## 3. Map Paint mode — multiple issues (feature ON STANDBY, recorded 2026-05-29)

User asked to **pause map-paint development** and record these for when we return. All observed
in-game on build with commits `417503b`/`953c319`:

- **3a. Can't exit paint mode (the banner does NOT dismiss, Esc/right-click don't leave).** The
  M5-paint-fix hint banner (`417503b`) pops up but **never disappears**, which means `undecorate()`
  isn't firing — i.e. the mode genuinely isn't exiting. So the earlier "didn't know to try Esc"
  answer was a red herring: paint mode **really traps** the player (unlike the M4.3 Claim mode, which
  shares the same `ChoosePlotInterfaceMode` base and DID exit cleanly — so something paint-specific
  is eating the cancel input or our `selectPlot` returning false is interfering). **Needs:** compare
  paint-tile-mode vs claim-tile-mode exit handling; verify the base cancel path (`handleInput` /
  right-click → `InterfaceMode.switchToDefault`) actually runs; the stuck banner is a reliable
  in-game signal that exit failed. This is the **top priority** when paint resumes — a trap is worse
  than a no-op.
- **3b. Features often can't be applied.** Many features (esp. world-wonder-like features) require a
  specific terrain/biome and/or a multi-tile footprint of a particular shape, so `setFeature` is
  silently rejected (no green flash). **Idea:** before/while painting, **highlight compatible tiles**
  for the selected type (query placement validity per plot and overlay-tint the legal ones), so the
  player isn't guessing. Needs a validity API (investigate `GameInfo.Features` constraints +
  any `*.canHaveFeature`/placement-rule call).
- **3c. Resources: works but same trap.** Adding a resource (tested **Llamas**) *does* apply, but
  then you "keep adding it wherever you click and can't exit" — same exit bug as 3a, just more
  visible because the paint succeeds each click.
- **Engine limitation (already known):** painted terrain doesn't visually redraw until a camera-pan
  over the plot or the next turn. The green flash is the per-click success confirmation; the banner
  states this. Not a bug — but worth a "nudge the camera" helper when we resume.

_Status:_ paint UI stays in the Map tab but is **on standby**; do not invest further until the
filtering / detailed-map / discovery work the user prioritized is done.

## 2. Confirm dialog text shows in English on a French-language game
- **Observed (M3):** the "Delete (disband) this unit?" confirm dialog renders in English even though
  the game UI is set to French.
- **Cause:** our `LOC_LCP_*` strings in `src/text/Cheat-Panel-Text.sql` are only authored for the
  `en_US` locale, so other locales fall back to English. (This is a localization-coverage gap, not a
  bug — the dialog itself works.)
- **Possible fix:** add `fr_FR` rows for the `LOC_LCP_*` keys, or accept English-only for a private
  mod. Low priority.
