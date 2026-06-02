# Discovery — Smooth exit from plot-selection modes (Item 2)

_Investigation + implementation. Base game unpacked at `…\Base\modules\` (build 23245653). Findings
cross-verified by two agents against base source. **Implemented** — see "Implementation" below._

## TL;DR

Pressing Esc in our claim/paint modes opened the **pause menu** instead of exiting, because our modes
inherit `ChoosePlotInterfaceMode.handleInput`, whose cancel path is gated behind
`!ViewManager.isWorldInputAllowed` and which never calls `stopPropagation()`. When world input is
disabled, the inherited handler returns `true` (pass-through), so the Esc reaches the global pause-menu
listener. **Fix:** override `handleInput` (the proven `INTERFACEMODE_ACQUIRE_TILE` pattern) to swallow
cancel inputs unconditionally — done once in a shared base class `LcpPlotMode`.

> **⚠ In-game finding (2026-06-02) — the ACTUAL blocker was a missing `reset()`.** The `handleInput`
> override was correct and *was* being invoked, but `InterfaceMode.switchToDefault()` threw
> `TypeError: this.reset is not a function`: `ChoosePlotInterfaceMode.transitionFrom()` calls
> `this.reset()` (interface-mode-choose-plot.js:48) **but the base class defines no `reset()`** — every
> base subclass (`acquire-tile`, `add-to-army`, `aerial-recon`, …) supplies its own. Our claim/paint
> modes never did, so *every* exit path (Esc, right-click, ✕ button) threw inside `transitionFrom`,
> **aborting the mode switch** → nothing exited and `undecorate()` never ran (banner stuck on screen).
> Fix: add `reset()` to `LcpPlotMode` (`reset() { this.isPlotProposed = false; }`). Both pieces are
> needed: the `handleInput` override (so Esc is caught regardless of `isWorldInputAllowed`) **and**
> `reset()` (so the switch completes). Also replaced tofu glyphs (`✕`/`⛏`/`🖌`) with plain text — the
> Gameface font lacks them (same class of issue as the M8 `■▲` tofu). Confirmed via `UI.log` (these
> interface-mode `LCP:` errors DO reach the log, unlike panel-isolate logs).

## 1. Inventory — plot-selection modes the panel enters

| Mode | File | Entered from |
|---|---|---|
| `INTERFACEMODE_LCP_CLAIM_TILE` | `claim-tile-mode.js` | Cities tab → **[Claim]** → `api.enterClaimMode` |
| `INTERFACEMODE_LCP_PAINT_TILE` | `paint-tile-mode.js` | Creative tab → **[Paint at clicked tile]** → `api.enterPaintMode` |

Both subclass `ChoosePlotInterfaceMode`. `cheat-panel.js` has **no** Esc handling that affects these
modes (its only `engine-input` handler closes the *panel* on `sys-menu`, and it's removed on detach; the
panel is closed before a mode is entered). Future resource-add/delete / natural-wonder modes will reuse
the same base, so they inherit the fix automatically.

## 2. Root cause — how Esc reaches the pause menu

The input pipeline (all in the main HUD context, not the panel isolate):

```
action-handler.js:180  const live = Framework.ContextManager.handleInput(inputEvent);
action-handler.js:184  if (live) window.dispatchEvent(inputEvent);     // ← only fires if NOT consumed
```
- `ContextManager.handleInput` runs registered handlers; **any handler returning `false` makes the whole
  thing return `false`** → `live=false` → `window.dispatchEvent` is skipped
  (`context-manager.js:583` `return !handlers.some(h => !h.handleInput(e))`).
- `InterfaceMode` is registered as handler **#2**, before ViewManager (`root-game.js:155`), and delegates
  to the current mode's `handleInput` (`interface-modes.js:160`). **So our mode's return value gates the
  pause menu. Return `false` = consumed (suppress pause menu); `true` = pass-through.**
- The pause menu is opened by a **separate `window` `engine-input` listener** in `root-game.js:282 → :228`
  on `name=='sys-menu' || 'keyboard-escape'` (status FINISH) → `InterfaceMode.switchTo("INTERFACEMODE_PAUSE_MENU")`.
  It only runs for events that survived (`live==true`).

The leak (`interface-mode-choose-plot.js:75-89`):
```
handleInput(inputEvent){
  if (inputEvent.detail.status != FINISH || !ViewManager.isWorldInputAllowed) return true;   // ← LEAK
  if (inputEvent.isCancelInput() || inputEvent.detail.name == "sys-menu") { …switchTo…; return false; }
  return true;
}
```
When `ViewManager.isWorldInputAllowed` is `false`, the cancel never gets swallowed → `return true` →
pause menu opens. Our modes don't override `handleInput`, so they're exposed. (Right-click tends to work
because `world-input.js` has a backup cancel path; Esc has no such backup.) The base placement modes that
exit cleanly — `interface-mode-acquire-tile.js:367`, `interface-mode-place-building.js:369` — **override
`handleInput`, drop the `isWorldInputAllowed` gate, and add `stopPropagation()`+`preventDefault()`.**

`Esc` maps to action **`keyboard-escape`** (`Input.xml:249`), which `isCancelInput()` matches
(`input-support.js:28` — also `cancel`, `mousebutton-right`). `cancel`/`sys-menu` are controller-only.

## 3. Candidate mechanisms

1. **Esc-intercept via `handleInput` override** — the real fix. Reliable (proven base pattern), no new
   bindings, covers Esc + right-click + controller-menu. **Chosen.**
2. **Floating "Cancel/Exit" button** — discoverable backup; interface-mode DOM lives in the HUD
   `document.body` (where `paint-tile-mode` already drew its hint banner), and `InterfaceMode.switchToDefault()`
   is UI-callable. **Added** (as a ✕ button on the shared banner) for discoverability.
3. **Non-Esc key (e.g. Backspace)** — unnecessary given 1+2. (`KEY_Q` is taken by `toggle-resources-layer`;
   `KEY_BACKSPACE` is the only clearly-unbound key if ever wanted, and would need a game-scope InputAction
   DB row.) **Skipped.**

## Implementation (done)

New shared base class **`src/ui/cheat-panel/lcp-plot-mode-base.js`** → `export default class LcpPlotMode
extends ChoosePlotInterfaceMode`:
- **`handleInput(inputEvent)`** — on status FINISH, if `isCancelInput() || name=='sys-menu' ||
  name=='keyboard-escape'` → `InterfaceMode.switchToDefault()`, `stopPropagation()`, `preventDefault()`,
  `return false`. No `isWorldInputAllowed` gate. Everything else passes through. (Guarded in try/catch.)
- **`decorate`/`undecorate`** — show/remove a shared top-center **exit banner** (`bannerTitle` /
  `hintText` / optional `hintNote`) with a clickable **✕ Exit** button (`pointer-events:auto` only on the
  button; container `pointer-events:none` so map clicks pass through). Lives in the HUD `document.body`.

`claim-tile-mode.js` and `paint-tile-mode.js` now `extend LcpPlotMode` (instead of
`ChoosePlotInterfaceMode`) and set their banner text in `initialize()`. `paint-tile-mode`'s old bespoke
hint banner was removed (the base owns it now); it keeps its flash-overlay logic and calls
`super.decorate()/super.undecorate()`. Registered `lcp-plot-mode-base.js` in the modinfo `<ImportFiles>`.
**New file + modinfo change → full game restart required.**

## Verified API reference

| API | Signature | Source |
|---|---|---|
| (override) `handleInput` | `(inputEvent) → boolean` — `false` = consumed (suppress pause menu) | `interface-mode-choose-plot.js:75`; called via `interface-modes.js:160` (handler #2, `root-game.js:155`) |
| `InputEngineEvent.isCancelInput` | `() → bool` (`cancel`/`keyboard-escape`/`mousebutton-right`) | `core/ui/input/input-support.js:28` |
| `InterfaceMode.switchToDefault` | `() → void` | `core/ui/interface-modes/interface-modes.js:135` (imported via `shared/imports.js`) |
| `inputEvent.stopPropagation` / `preventDefault` | consume; used by base placement modes | `acquire-tile.js:373-374`, `root-game.js:250-251` |
| pause-menu trigger | window `engine-input` listener on `sys-menu`/`keyboard-escape` | `root-game.js:228-253,282` |

## Open ❓ to confirm in-game
- Esc, right-click, and the ✕ button each cleanly exit claim **and** paint, with **no** pause menu.
- The banner is visible top-center and does **not** block map clicks (only the ✕ button takes clicks).
- Normal Esc → pause menu still works when **not** in a plot-selection mode.
