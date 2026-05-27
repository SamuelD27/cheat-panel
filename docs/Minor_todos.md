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

## 2. Confirm dialog text shows in English on a French-language game
- **Observed (M3):** the "Delete (disband) this unit?" confirm dialog renders in English even though
  the game UI is set to French.
- **Cause:** our `LOC_LCP_*` strings in `src/text/Cheat-Panel-Text.sql` are only authored for the
  `en_US` locale, so other locales fall back to English. (This is a localization-coverage gap, not a
  bug — the dialog itself works.)
- **Possible fix:** add `fr_FR` rows for the `LOC_LCP_*` keys, or accept English-only for a private
  mod. Low priority.
