# Phase 2 — Implementation Plan

> Companion to [discovery.md](discovery.md). Full approved plan also lives in the session plan file.

## 7. Skeleton choice — Fork Sovereign (private working copy)
- **(a) Fork Sovereign — CHOSEN.** Installed, proven on build 23245653, ships exactly the scaffolding
  we need (fxs tab-bar, steppers, confirm dialogs, draggable frame, dock `addButton` launcher, F8,
  `AffectsSavedGames=0`); its source verifies the hard APIs. Its tabs map onto our scope.
- (b) Fork Rayoz12 — older, single-file, no tabs/steppers/dialogs; rebuild for no gain.
- (c) Clean-room — re-derives ~600 LOC of working scaffolding; only justified to avoid dependence on
  Sovereign, irrelevant for a private, non-redistributed mod.

**Boundary:** private use only, no publishing. We copy the deployed files into `src/`, rename mod id →
`local-cheat-panel`, element → `panel-lcp`, loc keys → `LOC_LCP_*`, and disable the Workshop
Sovereign/Izica panels during dev.

## 8. Repo structure
See repo tree in [README.md](../README.md). Mod lives in `src/`; tabs split under
`ui/cheat-panel/` with `shared/{imports,api,state,widgets}.js`. **Risk:** mod-internal ES imports must
use `fs://game/base-standard/...` paths; if flaky (tested in M1), fall back to fewer files — but
`shared/imports.js` (engine import isolation) and `shared/api.js` stay regardless.

## 9. Deployment — directory junction
Same C: volume → junction works without admin. `scripts\link.ps1` creates
`Mods\local-cheat-panel -> .\src` (zero-copy, live). `scripts\deploy.ps1` is a robocopy fallback. Not
managed by Vortex. JS edits → in-game Reload UI; modinfo/xml/text/new files → restart.

## 10. Feature breakdown (confidence per Phase 1)
| # | Feature | APIs | Conf. | Acceptance |
|---|---|---|---|---|
| F1 | Gold | `Treasury.changeGoldBalance(amt,-1)` ✅ | High | gold rises immediately |
| F2 | Influence | `DiplomacyTreasury.changeDiplomacyBalance(amt)` ✅ | High | influence rises |
| F3 | Attribute pts | `Identity.addWildcardAttributePoints(1)` ✅ | High | wildcard points available |
| F4 | Yield lump | `Players.grantYield(pid, YIELD_*, amt)` ✅ | High | stockpile jumps |
| F5 | Sci/cul rate | needs modifiers ❓ | Low | *recommend lump-grant instead; defer* |
| F6 | Map reveal | no confirmed `setRevealed` ❓ | n/a | **do not ship**; use `EnableDebugPanels` |
| F7 | Instant research | tree→node→`grantYield(YIELD_SCIENCE)` ✅ | High | current tech completes |
| F8 | Instant civic | `getActiveTree()` + grant `YIELD_CULTURE` ✅ | High | current civic completes |
| F9 | ∞-move toggle | `Units.restoreMovement(id)` ✅; events ❓ | Med | full MP after turn + after moving |
| F10 | Duplicate + promotions | `CREATE_ELEMENT` ❓; promotion copy ❓ | Low | clone appears with promotions |
| F11 | Unit list (heal/+XP/restore/∞/delete/promote) | list ✅, heal/xp/restore ✅, delete/promote ❓ | Med | list shows units; row buttons act |
| F12 | City list (set pop/complete prod/+gold) | list ✅, prod ✅, +pop ✅, abs-pop ❓ | Med | list shows cities; row buttons act |
| F13 | Map paint (terrain/feature/resource/biome) | `WorldBuilder.MapPlots.set*` ✅; arg fmt + plot select ❓ | Med | click plot → data changes (visual next turn) |

## 11. Build order (each independently testable & revertable)
| M | Goal | Test signal | Cycles |
|---|---|---|---|
| **M0** | Fork, rebrand, deploy harness | F8 opens panel; +gold works; ONE dock button | 1–2 |
| **M1** | Modularize + LCP logging + SP guard | parity; UI.log shows `LCP:` | 1–2 |
| **M2** | Units tab per-row list (verified subset) | list matches units; row buttons act | 1–2 |
| **M3** | ∞-move + delete + promote + duplicate | toggle persists; clone has promotions | 2–3 |
| **M4** | Cities tab per-row list | list matches cities; row buttons act | 1–2 |
| **M5** | Map tab (plot paint) | click plot → terrain/feature/resource/biome changes | 3–5 |
| **M6** | Polish (steppers, drag-persist, conflict-detect, banners, docs) | coherent; no console errors | 1–2 |

Deviation from the task order is because M0 inherits working Player/Research/bulk tabs from Sovereign;
M1 front-loads the refactor so later milestones are additive, revertable diffs. ∞-move/duplication
(low confidence) isolated in M3; Map (riskiest) last.

## 12. Risk register
Research.md §10 items + Phase 1: method drift (mostly resolved via Sovereign; remaining ❓ → probe +
`try/catch` + `TODO(inferred)`); chunk drift (void; still isolate imports); fog reveal (don't ship);
natural wonders (single-tile only); terrain refresh (banner); op enums (known); attr pts (resolved);
console flaky (UI.log + junction); events (corrected; verify ∞-move events); no devtools (simple CSS).
New: SDK absent; Workshop conflict (disable during dev); `Game.maxPlayers` unverified (M1);
mod-internal imports (M1 probe); content fs path (resolved).

## 13. Testing approach
Junction → `~` Reload UI (JS) / restart (modinfo/xml). `scripts\tail-log.ps1` filters `LCP:`. Keep one
saved early-Antiquity game as the standing test bed; use debug spawn menu to top up units/cities.
Pre-code ❓ items via FireTuner dumps (if SDK) → `docs/api-snapshot-23245653.md`, else temporary
logging buttons. Per-feature §10 criteria + per-milestone §11 signal are the gates.

## 14. Implementation conventions
`LCP:` log prefix everywhere · `if (Game.maxPlayers > 1) return;` on every cheat · `AffectsSavedGames=0`
· all `/core` & `/core/ui-next` imports only in `shared/imports.js` · inferred APIs get
`// TODO(inferred)` + milestone callout · never edit outside repo except via deploy script · if an API
fails, stop and propose 2–3 options · English-only `LOC_LCP_*` · single launcher icon · achievements
disabled by design (documented).

## 15. Out of scope
Workshop publishing; multiplayer; non-English localization; extra custom icons; preserving achievements.
